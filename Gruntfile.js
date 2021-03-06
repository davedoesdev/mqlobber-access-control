"use strict";

module.exports = function (grunt)
{
    grunt.initConfig(
    {
        jshint: {
            src: [ 'index.js', 'Gruntfile.js', 'test/**/*.js' ],
            options: {
                node: true,
                esversion: 6
            }
        },

        mochaTest: {
            src: [ 'test/in-mem.js', 'test/tcp.js', 'test/example/example.js' ],
            options: {
                bail: true
            }
        },

        apidox: {
            input: [ 'index.js', 'events_doc.js' ],
            output: 'README.md',
            fullSourceDescription: true,
            extraHeadingLevels: 1,
            doxOptions: { skipSingleStar: true }
        },

        shell: {
            cover: {
                command: "./node_modules/.bin/nyc -x Gruntfile.js -x 'test/**' ./node_modules/.bin/grunt test",
                execOptions: {
                    maxBuffer: 10000 * 1024
                }
            },

            cover_report: {
                command: './node_modules/.bin/nyc report -r lcov'
            },

            cover_check: {
                command: './node_modules/.bin/nyc check-coverage --statements 100 --branches 100 --functions 100 --lines 100'
            },

            coveralls: {
                command: 'cat coverage/lcov.info | coveralls'
            }
        }
    });

    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-mocha-test');
    grunt.loadNpmTasks('grunt-shell');
    grunt.loadNpmTasks('grunt-apidox');

    grunt.registerTask('lint', 'jshint');
    grunt.registerTask('test', 'mochaTest');
    grunt.registerTask('docs', ['apidox']);
    grunt.registerTask('coverage', ['shell:cover',
                                    'shell:cover_report',
                                    'shell:cover_check']);
    grunt.registerTask('coveralls', 'shell:coveralls');
    grunt.registerTask('default', ['lint', 'test']);
};

