import _ from 'lodash';
import * as d3 from 'd3';
import frac from 'frac';
import vulgars from 'vulgarities';
import {vsprintf} from 'sprintf-js';
import Mustache from 'mustache';
import config from 'config.json';
import {makeRequests, getSprintMeta} from '../data';

export default class Format {
    constructor(locales, localization) {
        this.locales = locales;
        this.localization = localization;
        this.content = d3.select('#format-content');

        this.formatters = {};

        const numericDetails = {
            order: 2,
            type: 'numeric',
            format: (cell, v, key, data) => this.formatDetailsUnit(cell, v, key, data)
        };
        this.sourceLinks = {
            sonar: source => `${source.url}dashboard?id=${source.source_id}`,
            git: source => `${source.url}tree/master/${source.source_id}`,
            github: source => `${source.url}tree/master/${source.source_id}`,
            gitlab: source => `${source.url}tree/master/${source.source_id}`,
            tfs: source => `${source.url}?path=/${source.source_id}`
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
        this.value_format = {
            icon: (key, value, node, unit, config) => this.formatIcon(key, value, node, unit, config),
            duration: (key, value) => this.formatDuration(key, value),
            fraction: (key, value, node, unit) => this.formatFraction(key, value, unit)
        };
        this.cleanup();
    }

    getSprintDetails(details, sprints) {
        if (!details) {
            return {};
        }
        // Find the sprint ID that has details if there are multiple
        const sprint = _.isArray(sprints) ?
            _.find(sprints, id => !!details[id]) : sprints;
        return details[sprint] || {};
    }

    cleanup() {
        this.content.selectAll('*').remove();
        this.initialize();
    }

    initialize() {
    }

    orderSprints(sprints) {
        return _.reverse(sprints);
    }

    requestConfig(state) {
        return {
            sprints: this.orderSprints,
            metadata: this.localization.metadata,
            links: true
        };
    }

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

    defined(value) {
        return typeof value !== "undefined" && !_.isNaN(value) &&
            value !== null && value !== "NA";
    }

    format(data, state, resolve) {
        resolve(data);
    }

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

    formatDetailsNumber(cell, v) {
        cell.classed('has-text-right', true)
            .text(this.defined(v) ? this.formatNumber(v) : "\u2014");
    }

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
            cell.append('a')
                .attr('href', `${config.jira_url}/projects/${data.project_name}/versions/${v}`)
                .attr('target', '_blank')
                .text(fixversion);
        }
    }

    formatSprint(data, node, sprintMeta, meta=null, numeric=false) {
        var type = null;
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

    formatDuration(key, value) {
        var duration = {};
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

    formatFraction(key, value, unit) {
        const D = this.localization.metadata.values[key].denominator;
        const [quot, num, den] = frac(Number(value), D, true);
        var text = null;
        if (num === 0) {
            text = `${quot}`;
        }
        else {
            const fraction = `${num}/${den}`;
            text = `${quot === 0 ? '' : quot} ${vulgars[fraction] ? vulgars[fraction] : fraction}`;
        }
        return vsprintf(unit, [text]);
    }

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

    addIcon(container, icon, adjust) {
        adjust = _.assign({}, {
            class: "icon",
            iconWidth: 512,
            scale: 0.025,
            width: 16.25,
            top: 0,
            left: 0
        }, adjust);
        const packs = {fab: "brands", fas: "solid", far: "regular"};
        const node = container.append("path")
            .attr("class", adjust.class)
            .attr("d", `M ${adjust.iconWidth}, 512`)
            .attr("transform", `translate(${adjust.left}, ${adjust.top}) scale(${adjust.scale})`);
        /* jshint ignore:start */
        import(
            `@fortawesome/free-${packs[icon[0]]}-svg-icons/${_.camelCase(icon[1])}.js`
        ).then(fa => {
            node.attr("d", fa.svgPathData)
                .attr("transform", `translate(${adjust.left + (adjust.iconWidth - fa.width) * 0.5 * adjust.scale}, ${adjust.top}) scale(${adjust.scale})`);
        });
        /* jshint ignore:end */
    }

    formatMetricTarget(key, value, unit, node, config) {
        const bisectDate = d3.bisector(d => d.date).right;
        var metricTarget = {};
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
                        var node = d3.select(nodes[i]);
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

    getComponentFilter(filter, operator='in') {
        if (filter) {
            return ` and component ${operator} (${_.isArray(filter) ? _.join(filter, ',') : filter})`;
        }
        return '';
    }

    getProjectUrl(state, projectKey) {
        if (config.jira_url === "") {
            return null;
        }
        const project = state.projects.meta[projectKey];
        if (!project) {
            return this.getIssueUrl(projectKey);
        }
        if (project.component) {
            var component = project.component;
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

    getIssueUrl(issueKey) {
        if (config.jira_url === "") {
            return null;
        }
        return `${config.jira_url}/browse/${issueKey}`;
    }

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
