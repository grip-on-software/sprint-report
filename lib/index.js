import * as d3 from 'd3';
import axios from 'axios';
import moment from 'moment';
import {locale, navbar, spinner} from '@gros/visualization-ui';
import config from 'config.json';
import spec from './locale.json';
import builder from './builder';

const locales = new locale(spec, config.language);

const loadingSpinner = new spinner({
    width: d3.select('#container').node().clientWidth,
    height: 100,
    startAngle: 220,
    container: '#container',
    id: 'loading-spinner'
});
loadingSpinner.start();

const searchParams = new URLSearchParams(window.location.search);
locales.select(searchParams.get("lang"));
moment.locale(locales.lang);

axios.all([
    axios.get('data/quality_names.json'),
    axios.get('data/features.json')
]).then(axios.spread((projectsData, featuresData) => {
    const projects = projectsData.data,
          features = featuresData.data;
    axios.all([
        axios.get('data/descriptions.json'),
        axios.get('data/short_units.json')
    ]).then(axios.spread((descriptions, short_units) => {
        const build = new builder(projects, features, locales, moment, {
            descriptions: descriptions.data,
            short_units: short_units.data
        });
        build.makeConfiguration();
        build.makeTable();

        loadingSpinner.stop();
    })).catch((error) => {
        const build = new builder(projects, features, locales, moment, {
            descriptions: {},
            short_units: {}
        });
        build.makeConfiguration();
        build.makeTable();

        loadingSpinner.stop();
    });
})).catch((error) => {
    loadingSpinner.stop();
    d3.select('#error-message')
        .classed('is-hidden', false)
        .text(locales.message("error-message", [error]));
    throw error;
});

locales.updateMessages(d3.select('body'), ["title"]);

searchParams.delete("lang");
window.buildNavigation(navbar, locales, _.assign({}, config, {
    language_query: searchParams.toString() === '' ? 'lang' : `${searchParams}&lang`
}));
