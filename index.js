// through2 is a thin wrapper around node transform streams
var through = require('through2'),
    gutil = require('gulp-util'),
    chalk = gutil.colors,
    request = require('request'),
    https = require('https'),
    path = require('path'),
    fs = require('fs'),
    crypto = require('crypto');

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

    conf.options = opt; // export opts

    if(opt.checkSigs) this.hash.populate(); // fetch signatures sync

    return through.obj(function(file, enc, cb) {
        var request = function() {
            self.request(file, function(err, file) {
                if(err) {
                    this.emit('error', new PluginError(PLUGIN_NAME, err));
                    return cb();
                }
                this.push(file);
                gutil.log('gulp-tinypng: [compressing]', chalk.green('✔ ') + file.relative + chalk.gray(' (done)'));
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
            if(opt.checkSigs) {
                self.hash.compare(file, conf.sigs[file.relative], function(result, hash) {
                    if(result) {
                        file.skipped = true;
                        this.push(file);
                        gutil.log('gulp-tinypng: [skipping]', chalk.green('✔ ') + file.relative);
                        return cb();
                    }
                    self.hash.update(file, hash);
                    request();
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
        if(!errorSent) {
            if(opt.checkSigs) self.hash.write(); // write sigs after complete
        }
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
    request({
        url: 'https://api.tinypng.com/shrink',
        method: 'POST',
        strictSSL: false,
        headers: {
            'Accept': '*/*',
            'Cache-Control':  'no-cache',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + conf.token
        },
        body: file.contents
    }, function(err, res, body) {
        var data = (body && !err ? JSON.parse(body) : false),
            url = data.output ? data.output.url : false;

        if(err) {
            err = new Error('Initial upload request failed with message: "' + err.message + '"');
        } else {
            if(!url) err = new Error('No URL returned from API');
        }

        cb(err, url);
    });
};
/* TinyPNG.request.download -> Downloads the URL returned from a successful upload */
TinyPNG.request.download = function(url, cb) {
    https.get(url, function(res) {
        var body = '',
            err = false;

        res.setEncoding('binary');

        res.on('data', function(chunk) {
            if(res.statusCode == 200) body += chunk;
        });

        res.on('end', function() {
            if(!body) {
                err = new Error('No image returned from URL');
            } else {
                body = new Buffer(body, 'binary');
            }
            cb(err, body);
        });
    }).on('error', function(err) {
        cb(new Error('Download failed for ' + url + ' with error: ' + err.message), false);
    });
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
