var through = require('through2'),
    gutil = require('gulp-util'),
    chalk = gutil.colors,
    request = require('request'),
    path = require('path'),
    util = require('util'),
    fs = require('fs'),
    crypto = require('crypto'),
    minimatch = require('minimatch');

var PLUGIN_NAME = 'gulp-tinypng-compress',
    PluginError = gutil.PluginError;

/**
 * TinyPNG class
 * @todo Move into own library
 */
function TinyPNG(opt) {

    var self = this;

    this.conf = {
        token: null,
        options: {
            key: '',
            checkSigs: false, sigFile: false,
            log: false,
            force: false, ignore: false
        }
    };

    this.init = function(opt) {
        var errorSent = false;

        if(typeof opt !== 'object') opt = { key: opt };

        opt = util._extend(this.conf.options, opt);

        if(!opt.key) throw new PluginError(PLUGIN_NAME, 'Missing API key!');
        if(opt.checkSigs && !opt.sigFile) throw new PluginError(PLUGIN_NAME, 'sigFile required for checking signatures');

        if(!opt.force) opt.force = gutil.env.force || false; // force match glob
        if(!opt.ignore) opt.ignore = gutil.env.ignore || false; // ignore match glob

        this.conf.options = opt; // export opts

        this.conf.token = new Buffer('api:' + opt.key).toString('base64'); // prep key
        this.hash = new this.hasher(opt.sigFile).populate(); // init hasher class

        return through.obj(function(file, enc, cb) {
            if(self.glob(file, opt.ignore)) return cb();

            var request = function(success) {
                self.request(file, function(err, file) {
                    if(err) {
                        this.emit('error', new PluginError(PLUGIN_NAME, err));
                    } else {
                        this.push(file);
                        self.log('[compressing] ' + chalk.green('✔ ') + file.relative + chalk.gray(' (done)'));
                    }
                    success && success(!err);
                    return cb();
                }.bind(this)); // lol @ scoping
            }.bind(this);

            if(file.isNull()) {
                return cb();
            }

            if(file.isStream()) {
                this.emit('error', new PluginError(PLUGIN_NAME, 'Streams not supported'));
                return cb();
            }

            if(file.isBuffer()) {
                if(opt.checkSigs && !self.glob(file, opt.force)) {
                    self.hash.compare(file, function(result, hash) {
                        if(result) {
                            self.log('[skipping] ' + chalk.green('✔ ') + file.relative);
                            return cb();
                        }
                        request(function(done) {
                            if(done) self.hash.update(file, hash);
                        });
                    }.bind(this));
                } else {
                    request();
                }
            }
        })
        .on('error', function(err) {
            errorSent = true; // surely a method in the stream to handle this?
            self.log(err.message);
        })
        .on('end', function() {
            if(!errorSent && opt.checkSigs) self.hash.write(); // write sigs after complete
        });
    };

    this.request = function(file, cb) {
        this.upload = function(file, cb) {
            request.post({
                url: 'https://api.tinypng.com/shrink',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + self.conf.token
                },
                strictSSL: false,
                body: file.contents
            }, function(err, res, body) {
                var data,
                    url = false;

                if(err) {
                    err = new Error('Upload failed for ' + file.relative + ' with error: ' + err.message);
                } else if(body) {
                    try {
                        data = JSON.parse(body);
                    } catch(e) {
                        err = new Error('Upload response JSON parse failed, invalid data returned from API. Failed with message: ' + e.message);
                    }

                    if(!err) {
                        if(data.error) err = this.handler(data.error); else if(data.output.url) {
                            url = data.output.url;
                        } else err = new Error('Invalid TinyPNG response object returned for ' + file.relative);
                    }
                } else {
                    err = new Error('No content returned from TinyPNG API for' + file.relative);
                }

                cb(err, url);
            }.bind(this));
        };

        this.download = function(url, cb) {
            request.get({
                url: url,
                encoding: null
            }, function(err, res, body) {
                err = err ? new Error('Download failed for ' + url + ' with error: ' + err.message) : false;
                cb(err, body);
            });
        };

        this.handler = function(error) {
            var errs = {
                Unauthorized: 'The request was not authorized with a valid API key',
                InputMissing: 'The file that was uploaded is empty or no data was posted',
                BadSignature: 'The file was not recognized as a PNG or JPEG file. It may be corrupted or it is a different file type',
                UnsupportedFile: 'The file was recognized as a PNG or JPEG file, but is not supported',
                DecodeError: 'The file had a valid PNG or JPEG signature, but could not be decoded, most likely corrupt',
                TooManyRequests: 'Your monthly upload limit has been exceeded',
                InternalServerError: 'An internal error occurred during compression'
            };

            return new Error(error + ': ' + ((error in errs) ? errs[error] : 'unknown') + ' for ' + file.relative);
        };

        this.init = function(file, cb) {
            var self = this;

            self.upload(file, function(err, url) {
                if(err) return cb(err, file);
                self.download(url, function(err, data) {
                    if(err) return cb(err, file);

                    file.contents = data;
                    cb(false, file);
                });
            });
        };

        return this.init(file, cb);
    };

    this.hasher = function(sigFile) {
        this.sigFile = sigFile || false;
        this.sigs = {};

        this.calc = function(file, cb) {
            var md5 = crypto.createHash('md5');

            cb(md5.update(file.contents).digest('hex'));

            return this;
        };

        this.update = function(file, hash) {
            this.changed = true;
            this.sigs[file.relative] = hash;

            return this;
        };

        this.compare = function(file, cb) {
            this.calc(file, function(digest) {
                cb((file.relative in this.sigs && digest === this.sigs[file.relative]), digest);
            }.bind(this));

            return this;
        };

        this.populate = function() {
            var data = false;

            if(this.sigFile) {
                try {
                    data = fs.readFileSync(this.sigFile, 'utf-8');
                } catch(err) {
                    // meh
                }

                if(data) this.sigs = JSON.parse(data);
            }

            return this;
        };

        this.write = function() {
            if(this.changed) {
                try {
                    fs.writeFile(this.sigFile, JSON.stringify(this.sigs));
                } catch(err) {
                    // meh
                }
            }

            return this;
        };

        return this;
    };

    this.log = function(message, force) {
        if(this.conf.options.log || force) gutil.log(PLUGIN_NAME, message);
    };

    this.glob = function(file, glob, opt) {
        opt = opt || {};

        if(typeof glob === 'boolean') return glob;

        var result = minimatch(file.path, glob, opt);

        if(!result && !opt.matchBase) {
            opt.matchBase = true;
            return this.glob(file, glob, opt);
        }
        return result;
    };

    return this.init(opt);
}

module.exports = TinyPNG;
