/**
 * Base output format.
 *
 * Copyright 2017-2020 ICTU
 * Copyright 2017-2022 Leiden University
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
import frac from 'frac';
import vulgars from 'vulgarities';
import {vsprintf} from 'sprintf-js';
import Mustache from 'mustache';
import config from 'config.json';
import {makeRequests, getSprintMeta} from '../data';

/**
 * Output format type.
 */
export default class Format {
    constructor(locales, localization) {
        this.locales = locales;
        this.localization = localization;
        this.content = d3.select('#format-content');

        // Cache of formatters of numbers at different precisions
        this.formatters = {};

        // Links to specific source IDs for different source types
        this.sourceLinks = {
            sonar: source => `${source.url}dashboard?id=${source.source_id}`,
            git: source => `${source.url}tree/master/${source.source_id}`,
            github: source => `${source.url}tree/master/${source.source_id}`,
            gitlab: source => `${source.url}tree/master/${source.source_id}`,
            tfs: source => `${source.url}?path=/${source.source_id}`
        };

        // Details keys and how to order (column), sort (value rows, with a type
        // for the sort icon) and format them when displayed in a subtable
        const numericDetails = {
            order: 2,
            type: 'numeric',
            format: (cell, v, key, data) => this.formatDetailsUnit(cell, v, key, data)
        };
        this.details = {
            'key': {
                order: 0,
                sort: {
                    parts: [v => v, v => Number(v)],
                    split: '-',
                },
                format: (cell, v) => cell.append('a')
                    .attr('href', this.getIssueUrl(v))
                    .attr('target', '_blank')
                    .text(v)
            },
            'title': {
                order: 1,
                type: 'alpha'
            },
            'story_points': {
                order: 2,
                type: 'numeric',
                format: (cell, v) => this.formatDetailsNumber(cell, v)
            },
            'num': {
                order: 3,
                type: 'numeric',
                format: (cell, v) => this.formatDetailsNumber(cell, v)
            },
            'domain_name': {
                order: 1,
                format: (cell, v, feature, data) => this.formatDomain(cell, v, feature, data)
            },
            'fixversion': {
                order: 3,
                format: (cell, v, feature, data) => this.formatFixVersion(cell, v, data)
            },
            'avg_value': numericDetails,
            'end_value': numericDetails,
            'max_value': numericDetails,
            'min_value': numericDetails,
            'sum_value': numericDetails
        };

        // Metric target norms and when to show them, which Bulma class to
        // use for the unit text, and a title to display when hovering over
        // the unit text.
        this.norms = [
            {
                condition: (value, target) => value === target.perfect,
                classes: 'has-text-primary',
                title: () => this.locales.message('target-perfect')
            },
            {
                condition: (value, target) => target.target === value ||
                    (typeof target.direction === "undefined" ? true :
                        target.direction) === (target.target - value < 0),
                classes: 'has-text-success',
                title: (unit, target) => this.locales.message('target-good',
                    [vsprintf(unit, [target.target])]
                )
            },
            {
                condition: (value, target) =>
                    (typeof target.direction === "undefined" ? true :
                        target.direction) === (target.low_target - value) < 0,
                classes: 'has-text-warning',
                title: (unit, target) => {
                    const interval =  [
                        vsprintf(unit, [target.low_target]),
                        vsprintf(unit, [target.target])
                    ];
                    return this.locales.message('target-almost',
                        target.direction ? interval : _.reverse(interval)
                    );
                }
            },
            {
                condition: () => true,
                classes: 'has-text-danger',
                title: (unit, target) => this.locales.message('target-bad',
                    [vsprintf(unit, [target.low_target])]
                )
            }
        ];

        // Specific value formats for feature values, potentially shown within
        // a SVG element
        this.value_format = {
            icon: (key, value, node, unit, config) => this.formatIcon(key, value, node, unit, config),
            duration: (key, value) => this.formatDuration(key, value),
            fraction: (key, value, node, unit) => this.formatFraction(key, value, unit)
        };

        // Initial setup
        this.cleanup();
    }

    /**
     * Retrieve details of the features for the sprint (which may be a combined
     * sprint, as a list of sprint IDs).
     */
    getSprintDetails(details, sprints) {
        if (!details) {
            return {};
        }
        // Find the sprint ID that has details if there are multiple
        const sprint = _.isArray(sprints) ?
            _.find(sprints, id => !!details[id]) : sprints;
        return details[sprint] || {};
    }

    /**
     * Remove any previous content and set up the report format with initial,
     * empty elements.
     */
    cleanup() {
        this.content.selectAll('*').remove();
        this.initialize();
    }

    /**
     * Set up the report format with initial, empty elements.
     */
    initialize() {
    }

    /**
     * Adjust the order of an array of sprint data for display in the report
     * format, for example to display the most recent sprints first.
     */
    orderSprints(sprints) {
        return _.reverse(sprints);
    }

    /**
     * Select which auxliary data files to retrieve.
     */
    requestConfig(state) {
        return {
            sprints: this.orderSprints,
            metadata: this.localization.metadata,
            links: true
        };
    }

    /**
     * Create the report format by retrieving the data files and formatting them
     * all the while showing a loading spinner.
     */
    build(state, spinner) {
        this.content.classed('is-loaded', false);
        spinner.start();
        return new Promise((resolve, reject) => {
            makeRequests(state, this.requestConfig(state)).then((data) => {
                this.format(data, state, resolve);
                this.content.classed('is-loaded', true);
                spinner.stop();
            }).catch((error) => {
                spinner.stop();
                d3.select('#error-message')
                    .classed('is-hidden', false)
                    .text(this.locales.message("error-message", [error]));
                reject(error);
            });
        });
    }

    /**
     * Determine if a feature value is defined.
     */
    defined(value) {
        return typeof value !== "undefined" && !_.isNaN(value) &&
            value !== null && value !== "NA";
    }

    /**
     * Format the data into the report, after which the promise is resolved.
     */
    format(data, state, resolve) {
        resolve(data);
    }

    /**
     * Format a feature value as a number, adjusting precision to avoid
     * rounding errors from internal floating point representations.
     */
    formatNumber(value) {
        const prec = d3.precisionRound(value % 1 === 0 ? 1 : 0.1, value);
        if (_.isNaN(prec)) {
            return value;
        }
        if (!this.formatters[prec]) {
            this.formatters[prec] = d3.formatLocale(this.locales.selectedLocale)
                .format(`.${prec}r`);
        }
        return this.formatters[prec](value);
    }

    /**
     * Format a details cell as a number.
     */
    formatDetailsNumber(cell, v) {
        cell.classed('has-text-right', true)
            .text(this.defined(v) ? this.formatNumber(v) : "\u2014");
    }

    /**
     * Format a details cell as a number with a unit if its feature has one,
     * as well as possibly using the feature's metric targets for the norm.
     */
    formatDetailsUnit(cell, v, key, data) {
        const value = this.defined(v) ? this.formatNumber(v) : "\u2014";
        cell.classed('has-text-right', true);
        this.formatUnit(key, value, cell, {
            svg: false,
            adjust: {},
            date: data.date,
            metric: data.metric_targets
        });
    }

    /**
     * Format the name of a domain object using its source ID, linking to the
     * specific page at the source if possible.
     */
    formatDomain(cell, v, feature, data) {
        const source = _.find(data.source_ids[v], s =>
            this.sourceLinks[s.source_type] &&
            this.localization.sources.feature[s.source_type] &&
            this.localization.sources.feature[s.source_type]
                .has(feature)
        );
        if (source) {
            cell.append('a')
                .attr('href',
                    this.sourceLinks[source.source_type](source)
                )
                .attr('target', '_blank')
                .text(v);
        }
        else {
            cell.text(v);
        }
    }

    /**
     * Format a fix version from Jira, linking to it if possible.
     */
    formatFixVersion(cell, v, data) {
        if (!this.defined(v)) {
            cell.text("\u2014");
        }
        else if (config.jira_url === "") {
            cell.text(v);
        }
        else {
            const fixversion = data.fixversions &&
                data.fixversions[String(v)] ?
                data.fixversions[String(v)] : v;
            const issueKey = d3.select(cell.node().parentNode).select('td')
                .datum().key;
            const projectKey = issueKey ? issueKey.split("-")[0] : data.project_name;
            cell.append('a')
                .attr('href', `${config.jira_url}/projects/${projectKey}/versions/${v}`)
                .attr('target', '_blank')
                .text(fixversion);
        }
    }

    /**
     * Format a sprint using a metadata field.
     *
     * The `data` is an object or an array with two items, depending on whether
     * `meta` is provided. If it is not, the first element of the pair is the
     * metadata field to use, and the second element is the metadata value.
     * The `node` is an HTML or SVG element, this is differentiated by the SVG
     * element having a "meta" class if it is one; an HTML element must not have
     * this class. `sprintMeta` must be the sprint metadata state with all the
     * formats and options. If `meta` is provided, it determines the metadata
     * field to use from the `data` object. `numeric`, if set to true, avoids
     * formatting a numeric sprint metadata field so that it remains the raw
     * number value.
     *
     * The formatter can adjust the node to have classes, attributes and nested
     * elements (mostly for SVG elements). Formatters return either the text
     * to be added to the node by the caller, or `null`. The text is always
     * returned when `meta` is provided, otherwise it is up to the caller to
     * check if the return value is not `null` before using it in a `d3.text`
     * call, for example.
     */
    formatSprint(data, node, sprintMeta, meta=null, numeric=false) {
        let type = null;
        if (meta === null) {
            type = data[0];
            data = data[1];
            const title = this.locales.attribute("sprint_meta", type);
            const text = sprintMeta.format[type](data, node);
            if (node.classed('meta')) {
                if (text !== null) {
                    node.text(text);
                }
                node.append('title').text(title);
                return null;
            }
            else {
                node.attr('title', title);
                return text;
            }
        }
        else {
            type = getSprintMeta(sprintMeta, meta);
            data = data[type];
            if (numeric && sprintMeta.numeric.includes(type)) {
                return data;
            }
            return sprintMeta.format[type](data, node);
        }
    }

    /**
     * Format a duration value of a feature key.
     */
    formatDuration(key, value) {
        let duration = {};
        const intervals = this.localization.metadata.values[key].intervals;
        const remainder = _.reduce(intervals,
            (accumulator, time) => {
                duration[time.unit] = accumulator % time.num;
                return Math.floor(accumulator / time.num);
            },
            value
        );
        const last = intervals[intervals.length - 1];
        duration[last.unit] += remainder * last.num;
        const number = Math.round(this.localization.moment.duration(duration).as(last.unit));
        const text = this.localization.moment.localeData().relativeTime(
            number, true, number <= 1 ? last.key : last.key + last.key,
            false
        );
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    /**
     * Format a value that is usually described in a fraction of a feature key,
     * optionally with a unit format string.
     */
    formatFraction(key, value, unit) {
        const D = this.localization.metadata.values[key].denominator;
        const [quot, num, den] = frac(Number(value), D, true);
        let text = null;
        if (num === 0) {
            text = `${quot}`;
        }
        else {
            const fraction = `${num}/${den}`;
            text = `${quot === 0 ? '' : quot} ${vulgars[fraction] ? vulgars[fraction] : fraction}`;
        }
        return vsprintf(unit, [text]);
    }

    /**
     * Format a value of a feature key that is usually describe using an icon.
     * For SVG elements, the SVG representation of the icon is added or replaced
     * as a path to the container element indicated by `config.svg` with class
     * and sizing changes based on `config.adjust`. See also `Format.addIcon`.
     * Otherwise, a FontAwesome element is added or replaced, with a title with
     * attribute indicating the raw or unit-formatted value.
     */
    formatIcon(key, value, node, unit, config) {
        if (this.localization.metadata.values[key].icons[value]) {
            if (config.svg) {
                config.svg.select(`path.${config.adjust.class}`).remove();
                this.addIcon(config.svg,
                    this.localization.metadata.values[key].icons[value],
                    config.adjust
                );
                return "\u00A0\u00A0";
            }
            else if (node !== null) {
                node.selectAll('i').remove();
                node.append('i')
                    .attr('title', vsprintf(unit, [value]))
                    .attr('class',
                        this.localization.metadata.values[key].icons[value].join(' ')
                    );
                return null;
            }
        }
        return null;
    }

    /**
     * Include a FontAwesome icon into a SVG container element by using its
     * SVG path representation. The `icon` is an array with two elements where
     * the first item of the pair is the shorthand pack name, which is either
     * "fab", "fas" or "far", and the second item is the icon name. `adjust` is
     * an object that can contain the following items for class and sizing:
     * - class: The class name to add to the path element
     * - iconWidth: The width of the icon to display (at scale)
     * - scale: The ratio to use of the icon dimensions
     * - top: Number of pixels to move the icon from the top of the container
     * - left: Number of pixels to move the icon from the left of the container
     */
    addIcon(container, icon, adjust) {
        adjust = _.assign({}, {
            class: "icon",
            iconWidth: 512,
            scale: 0.025,
            top: 0,
            left: 0
        }, adjust);
        const packs = {fab: "brands", fas: "solid", far: "regular"};
        const node = container.append("path")
            .attr("class", adjust.class)
            .attr("d", `M ${adjust.iconWidth}, 512`)
            .attr("transform", `translate(${adjust.left}, ${adjust.top}) scale(${adjust.scale})`);
        // Import the icon definition to obtain SVG path data attribute.
        // The webpack/babel transpiler uses the following import statement to
        // write separate chunk bundles for all possible JavaScript files that
        // may be referenced by this, which makes the build longer and be of a
        // larger size and number of files, but the dynamic import only resolves
        // at runtime, so these files are unlikely to be loaded and bear no
        // weight for the browser.
        // We set the chunk name to the original file (with slashes and periods
        // replaced with dashes), which also applies to the production build,
        // avoiding unpredictable chunk names based on sequence numbers. This
        // allows us to add the icons to the HTML export (see lib/export.js,
        // HTML class, writeIcons method).
        /* jshint ignore:start */
        import(
            /* webpackChunkName: "[request]" */
            `@fortawesome/free-${packs[icon[0]]}-svg-icons/${_.camelCase(icon[1])}.js`
        ).then(fa => {
            node.attr("d", fa.svgPathData)
                .attr("transform", `translate(${adjust.left + (adjust.iconWidth - fa.width) * 0.5 * adjust.scale}, ${adjust.top}) scale(${adjust.scale})`);
        });
        /* jshint ignore:end */
    }

    /**
     * Format a metric target norm for a value of a feature key by checking
     * which norm for this feature has a proper threshold value and applying
     * its means of display (and title with a unit value in it) upon the node.
     * `config` is an object with the following items:
     * - `date`: The date at which the value was measured, in order to retrieve
     *   a metric target norm that was valid at this date.
     * - `metric`: The metric targets for the feature, if they are known aside
     *   from localization data which contains the default norms as defined in
     *   quality dashboard as of certain date. A project may have adjusted them
     *   to custom norms on dates, and this object contains those dates and
     *   new norms.
     */
    formatMetricTarget(key, value, unit, node, config) {
        const bisectDate = d3.bisector(d => d.date).right;
        let metricTarget = {};
        if (this.localization.metric_targets[key]) {
            const idx = bisectDate(this.localization.metric_targets[key], config.date) - 1;
            if (idx >= 0) {
                metricTarget = this.localization.metric_targets[key][idx];
            }
        }
        if (config.metric) {
            const idx = bisectDate(config.metric, config.date) - 1;
            if (idx >= 0) {
                metricTarget = _.assign({}, metricTarget, config.metric[idx]);
            }
        }
        if (!_.isEmpty(metricTarget)) {
            node.classed('has-text-weight-bold', true);
            node.classed(_.join(_.map(this.norms, spec => spec.classes), ' '),
                false
            );
            const norm = _.find(this.norms,
                spec => spec.condition(value, metricTarget)
            );
            node.classed(norm.classes, true)
                .attr('title', norm.title(unit, metricTarget));
        }
    }

    /**
     * Format a value of a feature key using a unit within a node, possibly
     * using a value formatter as well. Otherwise, the value is considered to
     * be numeric.
     */
    formatUnitText(key, value, unit="%s", node=null, config={}) {
        if (!this.defined(value)) {
            return this.locales.message("no-value");
        }
        if (this.localization.metadata.values &&
            this.localization.metadata.values[key] &&
            this.value_format[this.localization.metadata.values[key].type]
        ) {
            const type = this.localization.metadata.values[key].type;
            return this.value_format[type](key, value, node, unit, config);
        }
        return vsprintf(unit, [this.formatNumber(value)]);
    }

    /**
     * Format a value of a feature key within a node, using a unit formatter,
     * possibly a value formatter and a metric target norm as well.
     */
    formatUnit(key, value, node, config) {
        const unit = this.locales.retrieve(this.localization.short_units, key,
            "%s"
        );
        const text = this.formatUnitText(key, value, unit, node, config);
        if (config.date && this.defined(value)) {
            this.formatMetricTarget(key, value, unit, node, config);
        }
        if (text !== null) {
            node.text(text);
        }
    }

    /**
     * Add a label to a data value to indicate that it is part of a prediction.
     */
    addUnitLabel(d, tag, node) {
        if (d.endsWith("_error")) {
            const key = d.substring(d.search("-") + 1, d.length - 6);
            node.append(tag).text(" (");
            const unitNode = node.append(tag);
            node.append(tag)
                .text(` ${this.locales.attribute("predictor-error", key)})`);
            return unitNode;
        }
        else {
            node.attr('dy', 16)
                .attr('x', 25)
                .append(tag)
                .text(` ${this.locales.retrieve(this.localization.predictor, d)}: `);
            return node.append(tag);
        }
    }

    /**
     * Format a value for a feature key within a node. `config` is an object
     * that may have keys "svg" and "adjust" described by `Format.formatIcon`
     * and `Format.addIcon`, as well as "date" and "metric" described by
     * `Format.formatMetricTarget`.
     */
    formatFeature(key, value, node, config={}) {
        config = _.assign({}, {
            svg: false,
            adjust: {},
            date: null,
            metric: []
        }, config);
        if (_.isObject(value)) {
            if (this.defined(value.max) && value.min === value.max) {
                value = value.max;
            }
            else {
                const tag = config.svg ? 'tspan' : 'span';
                const two = _.isEqual(_.keys(value), ['min', 'max']);
                node.selectAll(`${tag}.range`).remove();
                node.append(tag)
                    .classed('range', true)
                    .attr('data-message', two ? 'range-value' : null)
                    .selectAll(tag)
                    .data(_.keys(value))
                    .enter()
                    .append(tag)
                    .attr('class', d => d)
                    .each((d, i, nodes) => {
                        let node = d3.select(nodes[i]);
                        if (!two) {
                            node = this.addUnitLabel(d, tag, node);
                        }
                        this.formatUnit(key, value[d], node, config);
                    });
                this.locales.updateMessages(node);
                return;
            }
        }

        this.formatUnit(key, value, node, config);
    }

    /**
     * Create a portion of a Jira JQL filter that filters upon component values.
     */
    getComponentFilter(filter, operator='in') {
        if (filter) {
            return ` and component ${operator} (${_.isArray(filter) ? _.join(filter, ',') : filter})`;
        }
        return '';
    }

    /**
     * Retrieve a URL that describes the project, team or component. This is
     * `null` if no proper URL can be deduced.
     */
    getProjectUrl(state, projectKey) {
        if (config.jira_url === "") {
            return null;
        }
        const project = state.projects.meta[projectKey];
        if (!project) {
            return this.getIssueUrl(projectKey);
        }
        if (project.component) {
            let component = project.component;
            if (_.isArray(component)) {
                component = component[0];
            }
            if (!_.isObject(component)) {
                component = {include: projectKey, exclude: null};
            }
            return `${config.jira_url}/secure/IssueNavigator.jspa?jqlQuery=\
project = ${project.project_names}${this.getComponentFilter(component.include)}\
${this.getComponentFilter(component.exclude, 'not in')}&runQuery=true`;
        }
        return project.team > 1 ?
            `${config.jira_url}/secure/RapidBoard.jspa?rapidView=${project.team}&view=planning` :
            this.getIssueUrl(project.project_names);
    }

    /**
     * Retrieve an URL to an issue in the project tracker.
     */
    getIssueUrl(issueKey) {
        if (config.jira_url === "") {
            return null;
        }
        return `${config.jira_url}/browse/${issueKey}`;
    }

    /**
     * Retrieve a URL to a sprint or fix version, based on sprint fields.
     */
    getSprintUrl(d) {
        if (config.jira_url === "") {
            return null;
        }
        const prefix = `${config.jira_url}/secure/`;
        if (d.fixversion) {
            return `${prefix}IssueNavigator.jspa?jqlQuery=\
fixVersion %3D ${d.fixversion}&runQuery=true`;
        }
        return (d.board_id ?
            `${prefix}GHLocateSprintOnBoard.jspa?sprintId=${d.sprint_id}&rapidViewId=${d.board_id}` :
            `${prefix}GHGoToBoard.jspa?sprintId=${d.sprint_id}`
        );
    }

    /**
     * Render a template for a URL based on project and sprint data.
     */
    makeSprintUrl(template, data, sprint={}) {
        Mustache.parse(template);
        const first = (v) => _.isArray(v) ? v[0] : v;
        const patterns = _.assign({}, data, sprint, {
            board_id: first(sprint.board_id),
            fixversion: first(sprint.fixversion),
            sprint_id: first(sprint.sprint_id),
            sprint_ids: _.join(_.concat([],
                sprint.fixversion || sprint.sprint_id
            ), ',')
        });
        return Mustache.render(template, patterns);
    }
}
