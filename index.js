var test = process.env.NODE_ENV == 'test',
    through = require('through2'),
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
function TinyPNG(opt, obj) {

    var self = this;

    this.conf = {
        token: null,
        options: {
            key: '',
            sigFile: false,
            log: false,
            force: false, ignore: false,
            sameDest: false
        }
    };

    this.init = function(opt) {
        if(typeof opt !== 'object') opt = { key: opt };

        opt = util._extend(this.conf.options, opt);

        if(!opt.key) throw new PluginError(PLUGIN_NAME, 'Missing API key!');

        if(!opt.force) opt.force = gutil.env.force || false; // force match glob
        if(!opt.ignore) opt.ignore = gutil.env.ignore || false; // ignore match glob

        this.conf.options = opt; // export opts

        this.conf.token = new Buffer('api:' + opt.key).toString('base64'); // prep key
        this.hash = new this.hasher(opt.sigFile).populate(); // init hasher class

        return this;
    };

    this.stream = function() {
        var self = this,
            opt = this.conf.options,
            emitted = false;

        return through.obj(function(file, enc, cb) {
            if(self.utils.glob(file, opt.ignore)) return cb();

            var request = function(success) {
                self.request(file).get(function(err, file) {
                    var end = function() { this.push(file); success && success(!err); cb(); }.bind(this);

                    if(err) {
                        this.emit('error', new PluginError(PLUGIN_NAME, err));
                    } else {
                        self.utils.log('[compressing] ' + chalk.green('✔ ') + file.relative + chalk.gray(' (done)'));

                        if(opt.sameDest) {
                            self.hash.calc(file, function(hash) {
                                self.hash.update(file, hash);

                                end();
                            });
                        } else {
                            end();
                        }
                    }
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
                if(opt.sigFile && !self.utils.glob(file, opt.force)) {
                    self.hash.compare(file, function(result, hash) {
                        if(result) {
                            self.utils.log('[skipping] ' + chalk.green('✔ ') + file.relative);
                            return cb();
                        }
                        request(function(done) {
                            if(done && !opt.sameDest) self.hash.update(file, hash);
                        });
                    }.bind(this));
                } else {
                    request();
                }
            }
        })
        .on('error', function(err) {
            emitted = true; // surely a method in the stream to handle this?
            self.utils.log(err.message);
        })
        .on('end', function() {
            if(!emitted && opt.sigFile) self.hash.write(); // write sigs after complete
        });
    };

    this.request = function(file, cb) {
        var self = this;

        return {
            file: {
                curr: file,
                new: (file && 'clone' in file) ? file.clone() : false
            },

            upload: function(cb) {
                var file = this.file.curr;

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
                        info = {
                            url: false,
                            count: res.headers['compression-count'] || 0
                        };
                    if(err) {
                        err = new Error('Upload failed for ' + file.relative + ' with error: ' + err.message);
                    } else if(body) {
                        try {
                            data = JSON.parse(body);
                        } catch(e) {
                            err = new Error('Upload response JSON parse failed, invalid data returned from API. Failed with message: ' + e.message);
                        }

                        if(!err) {
                            if(data.error) err = this.handler(data); else if(data.output.url) {
                                info.url = data.output.url;
                            } else err = new Error('Invalid TinyPNG response object returned for ' + file.relative);
                        }
                    } else {
                        err = new Error('No content returned from TinyPNG API for' + file.relative);
                    }

                    cb(err, info);
                }.bind(this));
            },

            download: function(url, cb) {
                request.get({
                    url: url,
                    encoding: null
                }, function(err, res, body) {
                    err = err ? new Error('Download failed for ' + url + ' with error: ' + err.message) : false;
                    cb(err, new Buffer(body));
                });
            },

            handler: function(data) {
                var errs = {
                    Unauthorized: 'The request was not authorized with a valid API key',
                    InputMissing: 'The file that was uploaded is empty or no data was posted',
                    BadSignature: 'The file was not recognized as a PNG or JPEG file. It may be corrupted or it is a different file type',
                    UnsupportedFile: 'The file was recognized as a PNG or JPEG file, but is not supported',
                    DecodeError: 'The file had a valid PNG or JPEG signature, but could not be decoded, most likely corrupt',
                    TooManyRequests: 'Your monthly upload limit has been exceeded',
                    InternalServerError: 'An internal error occurred during compression'
                };

                return new Error(data.error + ': ' + ((data.error in errs) ? errs[data.error] : data.message || 'unknown') + ' for ' + file.relative);
            },

            get: function(cb) {
                var self = this,
                    files = this.file;

                self.upload(function(err, data) {
                    if(err) return cb(err, files.curr);

                    self.download(data.url, function(err, data) {
                        if(err) return cb(err, files.curr);

                        files.new.contents = data;

                        cb(false, files.new);
                    });
                });

                return this;
            }
        };
    };

    this.hasher = function(sigFile) {
        return {
            sigFile: sigFile || false,
            sigs: {},

            calc: function(file, cb) {
                var md5 = crypto.createHash('md5');

                cb(md5.update(file.contents).digest('hex'));

                return this;
            },
            update: function(file, hash) {
                this.changed = true;
                this.sigs[file.relative] = hash;

                return this;
            },
            compare: function(file, cb) {
                this.calc(file, function(digest) {
                    cb((file.relative in this.sigs && digest === this.sigs[file.relative]), digest);
                }.bind(this));

                return this;
            },
            populate: function() {
                var data = false;

                if(this.sigFile) {
                    try {
                        data = fs.readFileSync(this.sigFile, 'utf-8');
                        if(data) data = JSON.parse(data);
                    } catch(err) {
                        // meh
                    }

                    if(data) this.sigs = data;
                }

                return this;
            },
            write: function() {
                if(this.changed) {
                    try {
                        fs.writeFileSync(this.sigFile, JSON.stringify(this.sigs));
                    } catch(err) {
                        // meh
                    }
                }

                return this;
            }
        };
    };

    this.utils = {
        log: function(message, force) {
            if(self.conf.options.log || force) gutil.log(PLUGIN_NAME, message);

            return this;
        },

        glob: function(file, glob, opt) {
            opt = opt || {};
            var result = false;

            if(typeof glob === 'boolean') return glob;

            try {
                result = minimatch(file.path, glob, opt);
            } catch(err) {}

            if(!result && !opt.matchBase) {
                opt.matchBase = true;
                return this.glob(file, glob, opt);
            }
            return result;
        }
    };

    return (obj || test) ? this.init(opt) : this.init(opt).stream();
}

module.exports = TinyPNG;
