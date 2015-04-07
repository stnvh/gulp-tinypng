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
    AUTH_TOKEN,

    skipped = 0,
    fileSigs = {},
    options = {};

// Consts
const PLUGIN_NAME = 'gulp-tinypng';

var prefixStream = function(prefixText) {
    var stream = through();
    stream.write(prefixText);
    return stream;
},

getFileHash = function(file, cb) {
    var md5 = crypto.createHash('md5');
    md5.update(file.contents);
    cb(md5.digest('hex'));
},

compareFileHash = function(file, hash, cb) {
    getFileHash(file, function(digest) {
        cb((digest === hash), digest);
    });
},

writeFileSigs = function() {
    fs.writeFile(options.sigFile, JSON.stringify(fileSigs), function(err) {
        if(err) return new PluginError(err);
    });
},

updateFileSigs = function(file, hash) {
    fileSigs[file.relative] = hash;
},

populateFileSigs = function(cb) {
    var data = false;
    try {
        data = fs.readFileSync(options.sigFile, 'utf-8');
    } catch(err) {
        // meh
    }

    if(data) fileSigs = JSON.parse(data);
},

download = function(uri, cb){
    https.get(uri, function(res) {
        var body = '';

        res.setEncoding('binary');

        res.on('data', function(chunk) {
            if(res.statusCode == 200) body += chunk;
        });
        res.on('end', function() {
            cb(new Buffer(body, 'binary'));
        });
    });
},

// Plugin level function (dealing with files)
gulpTinyPNG = function(opt) {
    if(typeof opt !== 'object') opt = { key: opt };

    if(!opt.key) return new PluginError(PLUGIN_NAME, 'Missing API key!');
    if(opt.checkSigs && !opt.sigFile) return new PluginError(PLUGIN_NAME, 'sigFile required for checking signatures');

    AUTH_TOKEN = new Buffer('api:' + opt.key).toString('base64');
    opt.key = new Buffer(opt.key); // allocate ahead of time

    options = opt; // export

    if(opt.checkSigs) populateFileSigs(); // fetch signatures sync

    // Creating a stream through which each file will pass
    var stream = through.obj(function (file, enc, callback) {

        var png = function() {
            tinypng(file, function(data) {
                file.contents = data;
                this.push(file);
                gutil.log('gulp-tinypng: [compressing]', gutil.colors.green('✔ ') + file.relative + gutil.colors.gray(' (done)'));
                return callback();
            }.bind(stream));
        };

        if(file.isNull()) {
            this.push(file); // Do nothing if no contents
            return callback();
        }

        if(file.isStream()) {
            return new PluginError(PLUGIN_NAME, 'Streams not supported');
        }

        if(file.isBuffer()) {
            var currentHash = null;
            if(opt.checkSigs) {
                compareFileHash(file, fileSigs[file.relative], function(result, hash) {
                    if(result) {
                        file.skipped = true;
                        stream.push(file);
                        gutil.log('gulp-tinypng: [skipping]', gutil.colors.green('✔ ') + file.relative);
                        return callback();
                    }
                    updateFileSigs(file, hash);
                    png();
                });
            } else {
                png();
            }
        }
    }).on('end', function() {
        if(opt.checkSigs) writeFileSigs(); // write sigs after complete
    });

  // returning the file stream
  return stream;
},

tinypng = function(file, cb) {
    request({
        url: 'https://api.tinypng.com/shrink',
        method: 'POST',
        strictSSL: false,
        headers: {
            'Accept': '*/*',
            'Cache-Control':  'no-cache',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + AUTH_TOKEN
        },
        body: file.contents
    }, function(error, response, body) {
        var results, filename;
        if(!error) {
            filename = path.basename(file.path);
            results = JSON.parse(body);
            if(results.output && results.output.url) {
                download(results.output.url, function(buffer) {
                    cb(buffer);
                });
            } else {
                gutil.log('gulp-tinypng: [error] - ', results.message);
            }
        }
    });
};

// Exporting the plugin main function
module.exports = gulpTinyPNG;
