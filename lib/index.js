/**
 * Main entry point for the sprint report.
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
import _ from 'lodash';
import * as d3 from 'd3';
import axios from 'axios';
import moment from 'moment';
import {Locale, Navbar, Spinner} from '@gros/visualization-ui';
import config from 'config.json';
import spec from './locale.json';
import Builder from './Builder';

const locales = new Locale(spec, config.language);

const loadingSpinner = new Spinner({
    width: d3.select('#container').node().clientWidth,
    height: 100,
    startAngle: 220,
    container: '#container .spinner',
    id: 'loading-spinner'
});
loadingSpinner.start();
d3.select(window).on("resize.spinner", () => {
    loadingSpinner.update({
        width: d3.select('#container').node().clientWidth
    });
});

const searchParams = new URLSearchParams(window.location.search);
locales.select(searchParams.get("lang"));
moment.locale(locales.lang);

// Track the Builder object.
let build = null;

// Retrieve the data (first the necessities, then localization/configuration)
axios.all([
    axios.get('data/projects_meta.json'),
    axios.get('data/features.json'),
    axios.get('data/expressions.json'),
    axios.get('data/categories.json')
]).then(axios.spread((projectsData, featuresData, expressionsData, categoriesData) => {
    const projects = projectsData.data,
          features = _.assign({}, featuresData.data, {
              expressions: expressionsData.data
          }),
          categories = categoriesData.data;
    axios.all([
        axios.get('data/descriptions.json'),
        axios.get('data/long_descriptions.json'),
        axios.get('data/short_units.json'),
        axios.get('data/units.json'),
        axios.get('data/predictor.json'),
        axios.get('data/metadata.json'),
        axios.get('data/sources.json'),
        axios.get('data/metric_targets.json'),
        axios.get('data/sprints.json')
    ]).then(requests => {
        const localization = {
            categories: categories,
            descriptions: requests.shift().data,
            long_descriptions: requests.shift().data,
            short_units: requests.shift().data,
            units: requests.shift().data,
            predictor: requests.shift().data,
            metadata: requests.shift().data,
            sources: requests.shift().data,
            metric_targets: requests.shift().data,
            moment: moment
        };
        const sprints = requests.shift().data;
        build = new Builder(projects, features, locales,
            localization, sprints
        );
        build.makeConfiguration(loadingSpinner);
    }).catch((error) => {
        build = new Builder(projects, features, locales,
            {
                categories: categories,
                descriptions: {},
                long_descriptions: {},
                short_units: {},
                units: {},
                predictor: {},
                metadata: {},
                sources: {},
                metric_targets: {},
                moment: moment
            },
            {
                limit: 5,
                closed: true,
                old: false
            }
        );
        build.makeConfiguration(loadingSpinner);
    }).finally(() => {
        // Collect the projects to show more prominently
        if (config.access_url !== "") {
            axios.get(config.access_url).then(request => {
                if (build !== null) {
                    build.setAccessible(request.data, loadingSpinner);
                }
            });
        }
    });
})).catch((error) => {
    loadingSpinner.stop();
    d3.select('#error-message')
        .classed('is-hidden', false)
        .text(locales.message("error-message", [error]));
    throw error;
});

locales.updateMessages();
locales.updateMessages(d3.select('#options'), ["data-tooltip"]);

if (typeof window.buildNavigation === "function") {
    window.buildNavigation(Navbar, locales, _.assign({}, config, {
        visualization: "sprint-report",
        language_query: 'lang'
    }));
}
