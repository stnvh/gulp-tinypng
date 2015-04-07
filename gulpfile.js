var gulp = require('gulp');
var gutil = require('gulp-util');
var tinypng = require('./index');


const TINYPNG_API = "8FiQFj9oWwEyTBHMMwxjvuYNx05Fphk2";

gulp.task('tinypng', function(){
  var stream;

  stream = gulp.src('original_images/**/*.png')
            .pipe(tinypng(TINYPNG_API))
            .pipe(gulp.dest('compressed_images'));
  return stream;
});
