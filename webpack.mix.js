/**
 * Entry point for the laraval-mix/webpack compilation.
 *
 * Copyright 2017-2020 ICTU
 * Copyright 2017-2022 Leiden University
 * Copyright 2017-2023 Leon Helwerda
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const _ = require('lodash'),
      fs = require('fs'),
      path = require('path'),
      mix = require('laravel-mix'),
      HtmlWebpackPlugin = require('html-webpack-plugin'),
      WebpackAssetsManifest = require('webpack-assets-manifest');

let config = process.env.SPRINT_REPORT_CONFIGURATION;
if (typeof config === 'undefined' || !fs.existsSync(config)) {
    config = path.resolve(__dirname, 'config.json');
}
if (!fs.existsSync(config)) {
    config = path.resolve(__dirname, 'lib/config.json');
}

const configuration = _.mapValues(JSON.parse(fs.readFileSync(config)),
    value => value.replace('$organization',
        typeof process.env.VISUALIZATION_ORGANIZATION !== 'undefined' ?
        process.env.VISUALIZATION_ORGANIZATION : ''
    )
);

Mix.paths.setRootPath(__dirname);
mix.setPublicPath('public/')
    .setResourceRoot('')
    .js('lib/index.js', 'public/bundle.js')
    .sass('res/main.scss', 'public/main.css')
    .browserSync({
        proxy: false,
        server: 'public',
        files: [
            'public/**/*.js',
            'public/**/*.css'
        ]
    })
    .babelConfig({
        "plugins": [ "@babel/plugin-syntax-dynamic-import" ],
        "env": {
            "test": {
                "plugins": [ "istanbul" ]
            }
        }
    })
    .webpackConfig({
        optimization: {
            chunkIds: 'named'
        },
        output: {
            path: path.resolve('public/'),
            publicPath: (configuration.path === "" ? "" : configuration.path + "/")
        },
        module: {
            rules: [ {
                test: /\.mustache$/,
                loader: 'mustache-loader',
                options: {
                    tiny: true,
                    render: Object.assign({}, configuration)
                }
            } ]
        },
        plugins: [
            new HtmlWebpackPlugin({
                template: 'template/index.mustache',
                inject: 'body'
            }),
            new WebpackAssetsManifest({
            })
        ],
        resolve: {
            alias: {
                'config.json$': config
            }
        }
    });

// Full API
// mix.js(src, output);
// mix.react(src, output); <-- Identical to mix.js(), but registers React Babel compilation.
// mix.extract(vendorLibs);
// mix.sass(src, output);
// mix.less(src, output);
// mix.stylus(src, output);
// mix.browserSync('my-site.dev');
// mix.combine(files, destination);
// mix.babel(files, destination); <-- Identical to mix.combine(), but also includes Babel compilation.
// mix.copy(from, to);
// mix.copyDirectory(fromDir, toDir);
// mix.minify(file);
// mix.sourceMaps(); // Enable sourcemaps
// mix.version(); // Enable versioning.
// mix.disableNotifications();
// mix.setPublicPath('path/to/public');
// mix.setResourceRoot('prefix/for/resource/locators');
// mix.autoload({}); <-- Will be passed to Webpack's ProvidePlugin.
// mix.webpackConfig({}); <-- Override webpack.config.js, without editing the file directly.
// mix.then(function () {}) <-- Will be triggered each time Webpack finishes building.
// mix.options({
//   extractVueStyles: false, // Extract .vue component styling to file, rather than inline.
//   processCssUrls: true, // Process/optimize relative stylesheet url()'s. Set to false, if you don't want them touched.
//   purifyCss: false, // Remove unused CSS selectors.
//   uglify: {}, // Uglify-specific options. https://webpack.github.io/docs/list-of-plugins.html#uglifyjsplugin
//   postCss: [] // Post-CSS options: https://github.com/postcss/postcss/blob/master/docs/plugins.md
// });
