process.env.NODE_ENV = 'test';

var fs = require('fs'),
	spawn = require('child_process').spawn,
	crypto = require('crypto'),
	expect = require('chai').expect,
    gutil = require('gulp-util'),

    TinyPNG = require('../index');

var key = 'NAoMjq0UjjWuLwVAAn9iVtGepjD38pDm',
	cwd = __dirname,
	TestFile = function(small) {
		var file = cwd + '/assets/image' + (small ? '_small' : '') + '.png';

		return new gutil.File({
			path: 'image.png',
			contents: fs.readFileSync(file)
		});
	};

describe('tinypng', function() {

	it('has valid API key', function() {
		var inst = new TinyPNG();

		inst.init({
			key: key
		});

		inst.request().upload(new TestFile(), function(err, file) {
			expect(err).to.equal(null);
			if(err) throw err;
		});

	});

	describe('#init', function() {
		var inst = new TinyPNG();

		it('set object configuration', function() {
			inst.init({
				key: 'test_string_0'
			});

			expect(inst.conf.options.key).to.equal('test_string_0');
			expect(inst.conf.token).to.equal(new Buffer('api:test_string_0').toString('base64'));
		});

		it('return stream object', function() {
			var init = inst.init({
				key: key
			});

			expect(init.writable).to.equal(true);
		});
	});

	describe('#request', function() {
		var inst = new TinyPNG(),
			image = new TestFile(),
			len = image.contents.length,
			download = null;

		inst.init({
			key: key
		});

		describe('#upload', function() {
			it('upload and return url', function(done) {
				this.timeout(10000);

				inst.request(image).upload(image, function(err, url) {
					expect(err).to.equal(null);
					expect(url).to.be.a('string');

					done();
				});
			});
		});

		describe('#download', function() {
			it('downloads and returns correct buffer', function(done) {
				this.timeout(10000);

				inst.request().download('http://ovh.net/files/1Mb.dat', function(err, data) {
					expect(err).to.equal(false);
					expect(data.toString()).to.equal(fs.readFileSync(cwd + '/assets/download.dat').toString());

					done();
				});
			});
		});

		describe('#handler', function() {
			it('returns correct error for API error value', function() {
				var error = inst.request(new TestFile()).handler('Unauthorized');

				expect(error.message).to.equal('Unauthorized: The request was not authorized with a valid API key for image.png');
			});

			it('returns correct unknown error', function() {
				var error = inst.request(new TestFile()).handler('Fatal');

				expect(error.message).to.equal('Fatal: unknown for image.png');
			});
		});

		describe('#init', function() {
			it('returns compressed image', function(done) {
				this.timeout(20000);

				inst.request().init(image, function(err, file) {
					expect(err).to.equal(false);
					expect(file.contents).to.have.length.lessThan(len);

					done();
				});
			});
		});
	});

	describe('#hasher', function() {
		var inst = new TinyPNG();

		inst.init({
			key: key
		});

		it('set signature file location', function() {
			expect(inst.hasher('test/location').sigFile).to.equal('test/location');
		});

		describe('#calc', function() {
			it('return md5 hash', function(done) {
				var file = new TestFile();

				inst.hasher().calc(file, function(md5) {
					expect(md5).to.equal(crypto.createHash('md5').update(file.contents).digest('hex'));

					done();
				});
			});
		});

		describe('#update', function() {
			it('update internal signature cache', function() {
				var file = new TestFile(),
					hash = inst.hasher();

				hash.update(file, 'test_hash');

				expect(hash.sigs).to.have.property(file.relative, 'test_hash');
				expect(hash.changed).to.equal(true);
			});
		});

		describe('#compare', function() {
			it('compare and succeed', function(done) {
				var file = new TestFile(),
					hash = inst.hasher();

				hash.calc(file, function(md5) {
					hash.update(file, md5);

					hash.compare(file, function(result, sig) {
						expect(result).to.equal(true);
						expect(sig).to.equal(md5);
						done();
					});
				});
			});

			it('compare and fail', function(done) {
				var file = new TestFile(),
					hash = inst.hasher();

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
			it('read from sig file and populate internal signature cache', function() {
				var hash = inst.hasher('.test');

				fs.writeFileSync('.test', JSON.stringify({'test.png': 'test_hash'}));

				hash.populate();

				fs.unlinkSync('.test');

				expect(hash.sigs).to.have.property('test.png', 'test_hash');
			});

			it('fail silently on failed read of sig file', function() {
				var hash = inst.hasher('.test');

				hash.populate();

				expect(hash.populate()).to.equal(inst.hasher('.test'))
			});
		});

		describe('#write', function() {
			it('write signature file with correct data', function() {
				var file = new TestFile(),
					hash = inst.hasher('.test');

				hash.update(file, 'test_hash');
				hash.write();
				expect(fs.readFileSync('.test').toString()).to.equal(JSON.stringify(hash.sigs));

				fs.unlinkSync('.test');
			});

			it('fail silently on failed write of sig file', function() {
				var file = new TestFile(),
					hash = inst.hasher();

				hash.update(file, 'test_hash');
				hash.write();

				expect(hash.write()).to.equal(inst.hasher());
			});
		});
	});

	describe('#glob', function() {
		var inst = new TinyPNG();

		inst.init({
			key: key
		});

		it('should return proper value on correct glob match', function() {
			var file = new TestFile();

			expect(inst.glob(file, '*ge.png')).to.equal(true);
			expect(inst.glob(file, '*go.png')).to.equal(false);
		});
	});
});

describe('tinypng gulp', function() {
	it('returns compressed files', function(done) {
		this.timeout(20000);

		var sh = spawn('node', ['node_modules/gulp/bin/gulp.js', 'tinypng']);

		sh.stdout.on('end', function() {
			var file = cwd + '/assets/tmp/image.png';

			expect(fs.existsSync(file)).to.equal(true, 'No file created using gulp');
			expect(fs.readFileSync(file).toString()).to.equal(new TestFile(true).contents.toString());

			fs.unlink(cwd + '/assets/tmp/image.png');
			done();
		});
	});

	it('ignores files on the cli', function(done) {
		this.timeout(10000);

		var sh = spawn('node', ['node_modules/gulp/bin/gulp.js', 'tinypng', '--ignore', '*ge.png']);

		sh.stdout.on('end', function() {
			var file = cwd + '/assets/tmp/image.png';

			expect(fs.existsSync(file)).to.equal(false);
			done();
		});
	});

	it('forces files on the cli', function(done) {
		this.timeout(20000);

		var inst = new TinyPNG(),
			hash = new inst.hasher('.sigs');

		process.env.TINYPNG_SIGS = true;

		hash.calc(new TestFile(), function(md5) {
			hash.update('image.png', md5);
			hash.write();

			var sh = spawn('node', ['node_modules/gulp/bin/gulp.js', 'tinypng', '--force', '*ge.png']);

			sh.stdout.on('end', function() {
				var file = cwd + '/assets/tmp/image.png';

				expect(fs.existsSync(file)).to.equal(true, 'No file created using gulp');
				expect(fs.readFileSync(file).toString()).to.equal(new TestFile(true).contents.toString());

				fs.unlinkSync(file);
				fs.unlinkSync('.sigs');

				process.env.TINYPNG_SIGS = false;

				done();
			});
		});
	});
});
