// through2 is a thin wrapper around node transform streams
var through = require('through2'),
    gutil = require('gulp-util'),
    chalk = gutil.colors,
    request = require('request'),
    path = require('path'),
    fs = require('fs'),
    crypto = require('crypto'),
    minimatch = require('minimatch');

var PluginError = gutil.PluginError,
    conf = {
        token: null,
        sigs: {},
        options: {}
    };

const PLUGIN_NAME = 'gulp-tinypng-compress';

function TinyPNG(opt) {
    return TinyPNG.init(opt);
}

TinyPNG.init = function(opt) {
    var self = this, // export self
        errorSent = false;

    if(typeof opt !== 'object') opt = { key: opt };

    if(!opt.key) throw new Error('Missing API key!');
    if(opt.checkSigs && !opt.sigFile) throw new Error('sigFile required for checking signatures');

    conf.token = new Buffer('api:' + opt.key).toString('base64');
    opt.key = new Buffer(opt.key); // allocate ahead of time

    if(!opt.force) opt.force = gutil.env.force || false; // force match glob
    if(!opt.ignore) opt.ignore = gutil.env.ignore || false; // ignore match glob

    conf.options = opt; // export opts

    if(opt.checkSigs) this.hash.populate(); // fetch signatures sync

    return through.obj(function(file, enc, cb) {
        if(self.glob(file, opt.ignore)) return cb();

        var request = function(success) {
            self.request(file, function(err, file) {
                if(err) {
                    this.emit('error', new PluginError(PLUGIN_NAME, err));
                } else {
                    this.push(file);
                    gutil.log('gulp-tinypng: [compressing]', chalk.green('✔ ') + file.relative + chalk.gray(' (done)'));
                }
                success && success(!err);
                return cb();
            }.bind(this)); // lol @ scoping
        }.bind(this);

        if(file.isNull()) {
            this.push(file);
            return cb();
        }

        if(file.isStream()) {
            this.emit('error', new PluginError(PLUGIN_NAME, 'Streams not supported'));
            return cb();
        }

        if(file.isBuffer()) {
            if(opt.checkSigs && !self.glob(file, opt.force)) {
                self.hash.compare(file, conf.sigs[file.relative], function(result, hash) {
                    if(result) {
                        gutil.log('gulp-tinypng: [skipping]', chalk.green('✔ ') + file.relative);
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
    .on('error', function() {
        errorSent = true; // surely a method in the stream to handle this?
    })
    .on('end', function() {
        if(!errorSent && opt.checkSigs) self.hash.write(); // write sigs after complete
    });
};

/* TinyPNG.request -> A wrapper for request.upload & request.download */
TinyPNG.request = function(file, cb) {
    var self = this.request; // self scope

    self.upload(file, function(err, url) {
        if(err) return cb(err, file);
        self.download(url, function(err, data) {
            if(err) return cb(err, file);

            file.contents = data;
            cb(false, file);
        });
    });
};
/* TinyPNG.request.upload -> Uploads the file and returns the compressed image URL */
TinyPNG.request.upload = function(file, cb) {
    request.post({
        url: 'https://api.tinypng.com/shrink',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + conf.token
        },
        body: file.contents
    }, function(err, res, body) {
        var url = false;

        if(err) {
            err = new Error('Upload failed for ' + file.relative + ' with error: ' + err.message);
        } else {
            try {
                url = JSON.parse(body).output.url;
            } catch(e) {
                err = new Error('Upload response JSON parse failed, invalid data returned from API. Failed with message: ' + e.message);
            }
        }

        cb(err, url);
    });
};
/* TinyPNG.request.download -> Downloads the URL returned from a successful upload */
TinyPNG.request.download = function(url, cb) {
    request.get({
        url: url,
        encoding: null
    }, function(err, res, body) {
        err = err ? new Error('Download failed for ' + url + ' with error: ' + err.message) : false;
        cb(err, body);
    });
};

/* TinyPNG.glob -> Performs match tests on a file name */
TinyPNG.glob = function(file, glob, opt) {
    if(!opt) opt = {};

    if(typeof glob === 'boolean') return glob;

    var result = minimatch(file.path, glob, opt);

    if(!result && !opt.matchBase) {
        opt.matchBase = true;
        return this.glob(file, glob, opt);
    }
    return result;
};

/* TinyPNG.hash -> File signature helpers */
TinyPNG.hash = {
    calc: function(file, cb) {
        var md5 = crypto.createHash('md5');

        md5.update(file.contents);
        var hash = md5.digest('hex');

        return cb(hash);
    },
    update: function(file, hash) {
        conf.changed = true;
        conf.sigs[file.relative] = hash;
    },
    compare: function(file, hash, cb) {
        this.calc(file, function(digest) {
            cb((digest === hash), digest);
        });
    },
    populate: function() {
        var data = false;

        try {
            data = fs.readFileSync(conf.options.sigFile, 'utf-8');
        } catch(err) {
            return err;
        }

        if(data) conf.sigs = JSON.parse(data);
    },
    write: function() {
        if(conf.changed) {
            try {
                fs.writeFile(conf.options.sigFile, JSON.stringify(conf.sigs));
            } catch(err) {
                // meh
            }
        }
    }
};

module.exports = TinyPNG;
