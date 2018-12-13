import _ from 'lodash';
import * as d3 from 'd3';
import axios from 'axios';
import moment from 'moment';
import {locale, navbar, spinner} from '@gros/visualization-ui';
import config from 'config.json';
import spec from './locale.json';
import Builder from './Builder';

const locales = new locale(spec, config.language);

const loadingSpinner = new spinner({
    width: d3.select('#container').node().clientWidth,
    height: 100,
    startAngle: 220,
    container: '#container .spinner',
    id: 'loading-spinner'
});
loadingSpinner.start();

const searchParams = new URLSearchParams(window.location.search);
locales.select(searchParams.get("lang"));
moment.locale(locales.lang);

axios.all([
    axios.get('data/projects_meta.json'),
    axios.get('data/features.json'),
    axios.get('data/expressions.json'),
    axios.get('data/categories.json')
]).then(axios.spread((projectsData, featuresData, expressionsData, categoriesData) => {
    const projects = projectsData.data,
          features = featuresData.data,
          expressions = expressionsData.data,
          categories = categoriesData.data;
    axios.all([
        axios.get('data/descriptions.json'),
        axios.get('data/long_descriptions.json'),
        axios.get('data/short_units.json'),
        axios.get('data/units.json'),
        axios.get('data/value_icons.json'),
        axios.get('data/sources.json'),
        axios.get('data/sprints.json')
    ]).then(axios.spread((descriptions, long_descriptions, short_units, units, value_icons, sources, sprints) => {
        const build = new Builder(projects, features, expressions, locales,
            moment, {
                categories: categories,
                descriptions: descriptions.data,
                long_descriptions: long_descriptions.data,
                short_units: short_units.data,
                units: units.data,
                value_icons: value_icons.data,
                sources: sources.data
            }, sprints.data
        );
        build.makeConfiguration(loadingSpinner);
    })).catch((error) => {
        const build = new Builder(projects, features, expressions, locales,
            moment, {
                categories: categories,
                descriptions: {},
                long_descriptions: {},
                short_units: {},
                value_icons: {},
                sources: {}
            }, {
                limit: 5,
                closed: true,
                old: false
            }
        );
        build.makeConfiguration(loadingSpinner);
    });
})).catch((error) => {
    loadingSpinner.stop();
    d3.select('#error-message')
        .classed('is-hidden', false)
        .text(locales.message("error-message", [error]));
    throw error;
});

locales.updateMessages(d3.select('body'), ["data-tooltip"]);

searchParams.delete("lang");
window.buildNavigation(navbar, locales, _.assign({}, config, {
    language_query: searchParams.toString() === '' ? 'lang' : `${searchParams}&lang`
}));
