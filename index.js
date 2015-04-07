// through2 is a thin wrapper around node transform streams
var through = require('through2'),
    gutil = require('gulp-util'),
    mkdirp = require('mkdirp'),
    rmdir = require( 'rmdir' ),
    request = require('request'),
    https = require('https'),
    path = require('path'),
    inspect = require('util').inspect,
    fs = require('fs'),
    crypto = require('crypto');

var PluginError = gutil.PluginError,
    conf = {
        token: null,
        sigs: {},
        options: {}
    };

const PLUGIN_NAME = 'gulp-tinypng';

function TinyPNG(opt) {
    return TinyPNG.init(opt);
}

TinyPNG.init = function(opt) {
    var self = this, // export self
        error = false;

    if(typeof opt !== 'object') opt = { key: opt };

    if(!opt.key) error = new Error('Missing API key!');
    if(opt.checkSigs && !opt.sigFile) error = new Error('sigFile required for checking signatures');

    if(!error) {
        conf.token = new Buffer('api:' + opt.key).toString('base64');
        opt.key = new Buffer(opt.key); // allocate ahead of time
    }

    conf.options = opt; // export opts

    if(opt.checkSigs) this.hash.populate(); // fetch signatures sync

    // Creating a stream through which each file will pass
    var stream = through.obj(function (file, enc, cb) {
        var request = function() {
            self.request(file, function(err, file) {
                if(err) return cb(new PluginError(PLUGIN_NAME, err));
                this.push(file);
                gutil.log('gulp-tinypng: [compressing]', gutil.colors.green('✔ ') + file.relative + gutil.colors.gray(' (done)'));
                return cb();
            }.bind(stream));
        };

        if(error) return cb(new PluginError(PLUGIN_NAME, error));

        if(file.isNull()) {
            this.push(file); // Do nothing if no contents
            return cb();
        }

        if(file.isStream()) {
            return cb(new PluginError(PLUGIN_NAME, 'Streams not supported'));
        }

        if(file.isBuffer()) {
            if(opt.checkSigs) {
                self.hash.compare(file, conf.sigs[file.relative], function(result, hash) {
                    if(result) {
                        file.skipped = true;
                        stream.push(file);
                        gutil.log('gulp-tinypng: [skipping]', gutil.colors.green('✔ ') + file.relative);
                        return cb();
                    }
                    self.hash.update(file, hash);
                    request();
                });
            } else {
                request();
            }
        }
    }).on('end', function() {
        if(opt.checkSigs) self.hash.write(); // write sigs after complete
    });

    // returning the file stream
    return stream;
};

/* TinyPNG.request -> A wrapper for request.upload & request.download */
TinyPNG.request = function(file, cb) {
    var self = this;

    self.request.upload(file, function(err, url) {
        if(err || !url) return cb(err || new Error('No URL returned from upload via API'), false);
        self.request.download(url, function(err, data) {
            if(err || !data) {
                return cb(err || new Error('No data returned from download URL'), false);
            }
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
        var results, filename;
        if(err) {
            return cb(err, false);
        }
        filename = path.basename(file.path);
        results = JSON.parse(body);
        if(results.output && results.output.url) {
            cb(false, results.output.url);
        } else {
            cb(false, false);
        }
    });
};
/* TinyPNG.request.download -> Downloads the URL returned from a successful upload */
TinyPNG.request.download = function(url, cb) {
    https.get(url, function(res) {
        var body = '';

        res.setEncoding('binary');

        res.on('data', function(chunk) {
            if(res.statusCode == 200) body += chunk;
        });

        res.on('end', function() {
            cb(false, new Buffer(body, 'binary'));
        });
    }).on('error', function(err) {
        cb(err, false);
    });
};

/* TinyPNG.hash -> File signature list helpers */
TinyPNG.hash = {
    calc: function(file, cb) {
        var md5 = crypto.createHash('md5');

        md5.update(file.contents);
        var hash = md5.digest('hex');

        cb(hash); return hash;
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
            // meh
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
