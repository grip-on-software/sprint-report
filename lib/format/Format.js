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

        var formatters = {};
        this.formatNumber = (value) => {
            const prec = d3.precisionRound(value % 1 === 0 ? 1 : 0.1, value);
            if (_.isNaN(prec)) {
                return value;
            }
            if (!formatters[prec]) {
                formatters[prec] = d3.formatLocale(this.locales.selectedLocale)
                    .format(`.${prec}r`);
            }
            return formatters[prec](value);
        };
        this.defined = value => typeof value !== "undefined" &&
            !_.isNaN(value) && value !== null && value !== "NA";

        const formatDetailsNumber = (cell, v) => {
            cell.classed('has-text-right', true)
                .text(v === "NA" ? "\u2014" : this.formatNumber(v));
        };
        const formatDetailsUnit = (cell, v, key, source_ids, date, metric_targets) => {
            const value = v === "NA" ? "\u2014" : this.formatNumber(v);
            cell.classed('has-text-right', true);
            this.formatUnit(key, value, cell, false, {}, date, metric_targets);
        };
        const numericDetails = {
            order: 2,
            type: 'numeric',
            format: formatDetailsUnit
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
                    parts: [
                        v => v,
                        v => Number(v)
                    ],
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
                format: formatDetailsNumber
            },
            'num': {
                order: 3,
                type: 'numeric',
                format: formatDetailsNumber
            },
            'domain_name': {
                order: 1,
                format: (cell, v, feature, source_ids) => {
                    const source = _.find(source_ids[v], s =>
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
            icon: (key, value, node, unit, svg, adjust) => {
                if (this.localization.metadata.values[key].icons[value]) {
                    if (svg) {
                        svg.select(`path.${adjust.class}`).remove();
                        this.addIcon(svg,
                            this.localization.metadata.values[key].icons[value],
                            adjust
                        );
                        return true;
                    }
                    else if (node !== null) {
                        node.selectAll('i').remove();
                        node.append('i')
                            .attr('title', vsprintf(unit, [value]))
                            .attr('class',
                                this.localization.metadata.values[key].icons[value].join(' ')
                            );
                        return true;
                    }
                }
                return false;
            },
            duration: (key, value) => {
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
            },
            fraction: (key, value, node, unit) => {
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
        };
        this.cleanup();
    }

    getSprintDetails(details, sprint_ids) {
        if (!details) {
            return {};
        }
        const sprint_id = _.isArray(sprint_ids) ?
            _.find(sprint_ids, id => !!details[id]) : sprint_ids;
        return details[sprint_id] || {};
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

    format(data, state, resolve) {
        resolve(data);
    }

    formatSprint(data, node, sprint_meta, meta=null, numeric=false) {
        var type = null;
        if (meta === null) {
            type = data[0];
            data = data[1];
            const title = this.locales.attribute("sprint_meta", type);
            const text = sprint_meta.format[type](data, node);
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
            type = getSprintMeta(sprint_meta, meta);
            data = data[type];
            if (numeric && sprint_meta.numeric.includes(type)) {
                return data;
            }
            return sprint_meta.format[type](data, node);
        }
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

    formatMetricTarget(key, value, node, date, metric, unit) {
        const bisectDate = d3.bisector(d => d.date).right;
        var metric_target = {};
        if (this.localization.metric_targets[key]) {
            const idx = bisectDate(this.localization.metric_targets[key], date) - 1;
            if (idx >= 0) {
                metric_target = this.localization.metric_targets[key][idx];
            }
        }
        if (metric) {
            const idx = bisectDate(metric, date) - 1;
            if (idx >= 0) {
                metric_target = _.assign({}, metric_target, metric[idx]);
            }
        }
        if (!_.isEmpty(metric_target)) {
            node.classed('has-text-weight-bold', true);
            node.classed(_.join(_.map(this.norms, spec => spec.classes), ' '),
                false
            );
            const norm = _.find(this.norms,
                spec => spec.condition(value, metric_target)
            );
            node.classed(norm.classes, true)
                .attr('title', norm.title(unit, metric_target));
        }
    }

    formatUnitText(key, value, unit="%s", node=null, svg=false, adjust={}) {
        if (!this.defined(value)) {
            return this.locales.message("no-value");
        }
        if (this.localization.metadata.values &&
            this.localization.metadata.values[key] &&
            this.value_format[this.localization.metadata.values[key].type]
        ) {
            const type = this.localization.metadata.values[key].type;
            return this.value_format[type](key, value, node, unit, svg, adjust);
        }
        return vsprintf(unit, [this.formatNumber(value)]);
    }

    formatUnit(key, value, node, svg=false, adjust={}, date=null, metric=[]) {
        const unit = this.locales.retrieve(this.localization.short_units, key,
            "%s"
        );
        const text = this.formatUnitText(key, value, unit, node, svg, adjust);
        if (date && this.defined(value)) {
            this.formatMetricTarget(key, value, node, date, metric, unit);
        }
        if (_.isString(text)) {
            node.text(text);
        }
    }

    formatFeature(key, value, node, svg=false, adjust={}, date=null, metric=[]) {
        if (_.isObject(value)) {
            if (this.defined(value.max) && value.min === value.max) {
                value = value.max;
            }
            else {
                const tag = svg ? 'tspan' : 'span';
                const two = _.keys(value).length === 2;
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
                            node.append(tag)
                                .text(` ${this.locales.retrieve(this.localization.predictor, d)}: `);
                            node = node.append(tag);
                        }
                        this.formatUnit(key, value[d], node, svg, adjust, date,
                            metric
                        );
                    });
                this.locales.updateMessages(node);
                return;
            }
        }

        this.formatUnit(key, value, node, svg, adjust, date, metric);
    }

    getComponentFilter(filter, operator='in') {
        if (filter) {
            return ` and component ${operator} (${_.isArray(filter) ? _.join(filter, ',') : filter})`;
        }
        return '';
    }

    getProjectUrl(state, project_key) {
        if (config.jira_url === "") {
            return null;
        }
        const project = _.find(state.projects.meta,
            p => p.name === project_key
        );
        if (!project) {
            return this.getIssueUrl(project_key);
        }
        if (project.component) {
            var component = project.component;
            if (_.isArray(component)) {
                component = component[0];
            }
            if (!_.isObject(component)) {
                component = {include: project_key, exclude: null};
            }
            return `${config.jira_url}/secure/IssueNavigator.jspa?` +
                `jqlQuery=project = ${project.project_names}` +
                this.getComponentFilter(component.include) +
                this.getComponentFilter(component.exclude, 'not in') +
                `&runQuery=true`;
        }
        return project.team > 1 ?
            `${config.jira_url}/secure/RapidBoard.jspa?rapidView=${project.team}&view=planning` :
            this.getIssueUrl(project.project_names);
    }

    getIssueUrl(issue_key) {
        if (config.jira_url === "") {
            return null;
        }
        return `${config.jira_url}/browse/${issue_key}`;
    }

    getSprintUrl(d) {
        if (config.jira_url === "") {
            return null;
        }
        if (d.fixversion) {
            return `${config.jira_url}/secure/IssueNavigator.jspa?jqlQuery=fixVersion %3D ${d.fixversion}&runQuery=true`;
        }
        return `${config.jira_url}/secure/` + (d.board_id ?
            `GHLocateSprintOnBoard.jspa?sprintId=${d.sprint_id}&rapidViewId=${d.board_id}` :
            `GHGoToBoard.jspa?sprintId=${d.sprint_id}`
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
