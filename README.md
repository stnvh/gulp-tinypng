[![Version](https://img.shields.io/npm/v/gulp-tinypng-compress.svg)][npm]
[![Downloaded](https://img.shields.io/npm/dm/gulp-tinypng-compress.svg)][npm]

# gulp-tinypng-compress

> [TinyPNG](https://tinypng.com) API wrapper for compressing PNG & JPG images

An actively maintained & developed fork of [gulp-tinypng](https://github.com/creativeaura/gulp-tinypng).

*Main differences from gulp-tinypng:*
- File signature checking (to minimise unnecessary API calls, optional)
- No temporary files/folders are created on compressed image download - fed straight from tinypng to the pipe
- Maintained with the intention of standardising the tinypng featureset across gulp & grunt (and others too!)

## Install

Install with [npm](https://npmjs.org/package/gulp-tinypng-compress) - In your project folder, run:

```
npm install --save-dev gulp-tinypng-compress
```

## Example

```js
var gulp = require('gulp');
var tinypng = require('gulp-tinypng-compress');

gulp.task('tinypng', function () {
	gulp.src('images/src/**/*.{png,jpg,jpeg}')
		.pipe(tinypng({
			key: 'API_KEY',
			checkSigs: true,
			sigFile: 'images/.tinypng-sigs'
		}))
		.pipe(gulp.dest('images'));
});
```

## API

### tinypng([options])

Returns Stream containing compressed images

#### options
Type: `Object` / `String`
Default: `false`

Sets options described below from its properties. If type is not object, string presumed (the API key)

#### options.key
Type: `String`
Default: `''`

Your TinyPNG API key to use for requests

#### options.checkSigs
Type: `Boolean`
Default: `false`

Whether or not to compare existing source file md5 signatures against those found in the options.sigFile json data. When the signatures match, the file is skipped from being minified again, allowing you to better stay within your API request limits. When an image is minified, and options.checkSigs is true, the md5 signature is determined from the unminified source image and written to the file at options.sigFile (a suggested location would be somewhere under your source control).

Signatures are based off the unminified source image, so that when the source changes it will be re-minified and re-written to the destination file.

#### options.sigFile
Type: `String`
Default: `''`

The file location to write the source image md5 signatures to when using the options.checkSigs option

#### options.force
Type: `Boolean` / `String`
Default: `false`

Force compress images regardless of signature. Value can either be `true` to force all images, or a glob pattern string to match against the filename(s).

Can also be performed from the **command line**:
```bash
$ gulp png --force 'icon-*.png'
```

This feature was added as it's impossible to know where the files are being written to at this point in the stream, unless the directory is directly passed into the config (pretty ugly). So the option was added to force certain (or all) files to be compressed when required.

#### options.ignore
Type: `Boolean` / `String`
Default: `false`

Same as `options.force` except ignores files if the glob is matched

`--ignore` flag on the command line

## License

MIT © Stan Hutcheon - Bigfork Ltd.

**Original license:**

>MIT © [Gaurav Jassal](http://gaurav.jassal.me)

[npm]: https://www.npmjs.com/package/gulp-tinypng-compress
