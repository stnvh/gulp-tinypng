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

## License

MIT © Stan Hutcheon - Bigfork Ltd.

**Original license:**

>MIT © [Gaurav Jassal](http://gaurav.jassal.me)
