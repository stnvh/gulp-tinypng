process.env.NODE_ENV = 'test';

var fs = require('fs'),
	spawn = require('child_process').spawn,
	crypto = require('crypto'),
	expect = require('chai').expect,
    gutil = require('gulp-util'),

	dry = process.env.PNG_DRY ? true : false,

    TinyPNG = require('../index');

var key = 'rlDAQuwa4AOtQPaekNpu-HgLOedHXOlh',
	cwd = __dirname,
	TestFile = function(small) {
		var file = cwd + '/assets/image' + (small ? '_small' : '') + '.png';

		return new gutil.File({
			path: 'image.png',
			contents: fs.readFileSync(file)
		});
	};

if(dry) console.info('dry flag set, skipping API tests...');

describe('tinypng', function() {
	it('has correct bound object', function() {
		var struct = ['conf', 'init', 'stream', 'request', 'hasher', 'utils', 'hash', 'stats'],
			inst = new TinyPNG(key);

		expect(inst).to.have.all.keys(struct);
	});

	it('transforms key into config object', function() {
		var inst = new TinyPNG('test_string_0');

		expect(inst.conf.options.key).to.equal('test_string_0');
	});

	it('init hashing object', function() {
		var struct = ['sigFile', 'sigFolder', 'sigs', 'calc', 'update', 'compare', 'mkdir', 'populate', 'walkDir', 'writeFile', 'writeFolder'],
			inst = new TinyPNG(key);

		expect(inst.hash).to.have.all.keys(struct);
	});

	describe('#init', function() {
		it('sets object configuration', function() {
			var inst = new TinyPNG({
				key: 'test_string_0',
				sigFile: 'test_string_1'
			});

			expect(inst.conf.options.key).to.equal('test_string_0');
			expect(inst.conf.options.sigFile).to.equal('test_string_1');

			expect(inst.conf.token).to.equal(new Buffer('api:test_string_0').toString('base64'));
		});

		it('throws error on missing API key', function() {
			expect(TinyPNG).to.throw(Error, /missing api key/i);
		});
	});

	describe('#request', function() {
		var struct = ['file', 'upload', 'download', 'handler', 'get'],
			inst = new TinyPNG(key),
			image = new TestFile();

		it('returns correct object', function() {
			expect(inst.request()).to.have.all.keys(struct);
			expect(new inst.request()).to.have.all.keys(struct);
		});

		describe('#upload', function() {
			it('uploads and returns object', function(done) {
				this.timeout(20000);

				if(dry) return done();

				inst.request(image).upload(function(err, data) {
					expect(err).to.not.be.instanceof(Error);
					expect(data).to.have.all.keys(['url', 'count']);

					done();
				});
			});
		});

		describe('#download', function() {
			it('downloads and returns correct buffer', function(done) {
				this.timeout(20000);

				inst.request(new TestFile()).download('http://ovh.net/files/1Mb.dat', function(err, data) {
					expect(err).to.not.be.instanceof(Error);
					expect(data.toString()).to.equal(fs.readFileSync(cwd + '/assets/download.dat').toString());

					done();
				});
			});
		});

		describe('#handler', function() {
			it('returns correct unknown error', function() {
				var request = new inst.request(new TestFile());

				expect(request.handler({ error: 'TestError'}, 500).message).to.equal('TestError (500): No message returned for image.png');
				expect(request.handler({ error: 'TestError', message: 'test'}, 500).message).to.equal('TestError (500): test for image.png');
			});
		});

		describe('#get', function() {
			it('returns compressed image', function(done) {
				this.timeout(30000);

				if(dry) return done();

				inst.request(image).get(function(err, file) {
					expect(err).to.not.be.instanceof(Error);
					expect(file.contents).to.have.length.lessThan(image.contents.length);

					done();
				});
			});
		});
	});

	describe('#hasher', function() {
        var struct = ['sigFile', 'sigFolder', 'sigs', 'calc', 'update', 'compare', 'mkdir', 'populate', 'walkDir', 'writeFile', 'writeFolder'],
			inst = new TinyPNG(key),
			hash = new inst.hasher('test/location');

		it('returns correct object', function() {
			expect(inst.hasher()).to.have.all.keys(struct);
			expect(new inst.hasher()).to.have.all.keys(struct);
		});

		it('sets signature file location', function() {
			expect(hash).to.have.property('sigFile', 'test/location');
		});

		describe('#calc', function() {
			it('returns md5 hash', function(done) {
				var file = new TestFile();

				hash.calc(file, function(md5) {
					expect(md5).to.equal(crypto.createHash('md5').update(file.contents).digest('hex'));

					done();
				});
			});
		});

		describe('#update', function() {
			it('updates internal signature cache', function() {
				var file = new TestFile(),
					hash = new inst.hasher();

				hash.update(file, 'test_hash');

				expect(hash.sigs).to.have.property(file.relative, 'test_hash');
				expect(hash.changed).to.equal(true);
			});
		});

		describe('#compare', function() {
			it('compares and succeeds', function(done) {
				var file = new TestFile(),
					hash = new inst.hasher();

				hash.calc(file, function(md5) {
					hash.update(file, md5);

					hash.compare(file, function(result, sig) {
						expect(result).to.equal(true);
						expect(sig).to.equal(md5);

						done();
					});
				});
			});

			it('compares and fails', function(done) {
				var file = new TestFile(),
					hash = new inst.hasher();

				hash.calc(file, function(md5) {
					hash.compare(file, function(result, sig) {
						expect(result).to.equal(false);
						expect(sig).to.equal(md5);

						done();
					});
				});
			});
		});

		describe('#populate', function() {
			afterEach(function() {
				try {
					fs.unlinkSync('.test');
				} catch(err) {}
			});

			it('reads from sig file and populate internal signature cache', function() {
				fs.writeFileSync('.test', JSON.stringify({'test.png': 'test_hash'}));

				var hash = new inst.hasher('.test').populate();

				expect(hash.sigs).to.have.property('test.png', 'test_hash');
			});

			it('fails silently on failed read of sig file', function() {
				var hash = new inst.hasher('.test');

				expect(hash.populate()).to.equal(hash);
			});

			it('doesn\'t error on failed JSON parse', function() {
				var hash = new inst.hasher('/etc/hosts');

				expect(hash.populate).to.not.throw(Error);
				expect(hash.populate()).to.not.be.instanceof(Error);
			});
		});

		describe('#writeFile', function() {
			afterEach(function() {
				try {
					fs.unlinkSync('.test');
				} catch(err) {}
			});

			it('writes signature file with correct data', function() {
				var file = new TestFile(),
					hash = new inst.hasher('.test');

				hash.update(file, 'test_hash');
				hash.writeFile();

				expect(fs.readFileSync('.test').toString()).to.equal(JSON.stringify(hash.sigs));
			});

			it('fails silently on failed write of sig file', function() {
				var file = new TestFile(),
					hash = new inst.hasher();

				hash.update(file, 'test_hash');

				expect(hash.writeFile()).to.equal(hash);
			});
		});

        describe('#writeFolder', function() {
			afterEach(function() {
                var rmDir = function(dirPath) {
                    try { var files = fs.readdirSync(dirPath); }
                    catch(e) { return; }
                    if (files.length > 0)
                        for (var i = 0; i < files.length; i++) {
                            var filePath = dirPath + '/' + files[i];
                            if (fs.statSync(filePath).isFile())
                                fs.unlinkSync(filePath);
                            else
                                rmDir(filePath);
                        }
                    fs.rmdirSync(dirPath);
                };

				try {
					rmDir('.test_folder');
				} catch(err) {}
			});

			it('writes signature file with correct data', function() {
				var file = new TestFile(),
					hash = new inst.hasher(null, '.test_folder');

				hash.update(file, 'test_hash');
				hash.writeFolder();

				expect(fs.readFileSync('.test_folder/' + file.path + '.sig').toString()).to.equal(hash.sigs[file.path]);
			});

            it('fails silently on failed write of sig file', function() {
                var file = new TestFile(),
                    hash = new inst.hasher();

                hash.update(file, 'test_hash');

                expect(hash.writeFolder()).to.equal(hash);
            });
		})
	});

	describe('utils', function() {
		describe('#glob', function() {
			var inst = new TinyPNG(key);

			it('returns proper value on correct glob match', function() {
				var file = new TestFile();

				expect(inst.utils.glob(file, '*ge.png')).to.equal(true);
				expect(inst.utils.glob(file, '*go.png')).to.equal(false);
			});
		});
	});
});

describe('tinypng gulp', function() {
	var target = cwd + '/assets/tmp/image.png';

	before(function() {
		process.env.TINYPNG_SIGS = true;
		process.env.TINYPNG_KEY = key;
	});

	after(function() {
		process.env.TINYPNG_SIGS = false;
	});

	afterEach(function() {
		try {
			fs.unlinkSync(target); fs.unlinkSync('.sigs');
		} catch(err) {}
	});

	it('returns compressed files', function(done) {
		this.timeout(30000);
		if(dry) return done();

		file = new TestFile();

		var sh = spawn('node', ['node_modules/gulp/bin/gulp.js', 'tinypng']);

		sh.stdout.on('end', function() {
			expect(fs.existsSync(target)).to.equal(true, 'compressed output file created');
			expect(fs.readFileSync(target)).to.have.length.lessThan(file.contents.length);

			done();
		});
	});

	it('ignores files on the cli', function(done) {
		this.timeout(20000);

		var sh = spawn('node', ['node_modules/gulp/bin/gulp.js', 'tinypng', '--ignore', '*ge.png']);

		sh.stdout.on('end', function() {
			expect(fs.existsSync(target)).to.equal(false);

			done();
		});
	});

	it('forces files on the cli', function(done) {
		this.timeout(30000);
		if(dry) return done();

		var inst = new TinyPNG(key),
			hash = new inst.hasher('.sigs'),
			file = new TestFile();

		hash.calc(file, function(md5) {
			hash.update(file, md5);
			hash.writeFile();

			var sh = spawn('node', ['node_modules/gulp/bin/gulp.js', 'tinypng', '--force', '*ge.png']);

			sh.stdout.on('end', function() {
				expect(fs.existsSync(target)).to.equal(true, 'compressed output file created');
				expect(fs.readFileSync(target)).to.have.length.lessThan(file.contents.length);

				done();
			});
		});
	});
});
