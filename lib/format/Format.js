import _ from 'lodash';
import * as d3 from 'd3';
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
            if (!formatters[prec]) {
                formatters[prec] = d3.formatLocale(this.locales.selectedLocale)
                    .format(`.${prec}r`);
            }
            return formatters[prec](value);
        };
        this.defined = value => typeof value !== "undefined" &&
            value !== null && value !== "NA";

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
                    if (source_ids[v] && source_ids[v].length === 1) {
                        const source = source_ids[v][0];
                        cell.append('a')
                            .attr('href',
                                `${source.url}dashboard?id=${source.source_id}`
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
                title: (key, target) => this.locales.message('target-good',
                    [this.formatUnitText(key, target.target)]
                )
            },
            {
                condition: (value, target) =>
                    (typeof target.direction === "undefined" ? true :
                        target.direction) === (target.low_target - value) < 0,
                classes: 'has-text-warning',
                title: (key, target) => {
                    const interval =  [
                        this.formatUnitText(key, target.low_target),
                        this.formatUnitText(key, target.target)
                    ];
                    return this.locales.message('target-almost',
                        target.direction ? interval : _.reverse(interval)
                    );
                }
            },
            {
                condition: () => true,
                classes: 'has-text-danger',
                title: (key, target) => this.locales.message('target-bad',
                    [this.formatUnitText(key, target.low_target)]
                )
            }
        ];
        this.value_format = {
            icon: (key, value, node, text, svg, adjust) => {
                if (this.localization.values[key].icons[value]) {
                    if (svg) {
                        svg.select(`path.${adjust.class}`).remove();
                        this.addIcon(svg,
                            this.localization.values[key].icons[value], adjust
                        );
                    }
                    else {
                        node.selectAll('i').remove();
                        node.append('i')
                            .attr('title', text)
                            .attr('class',
                                this.localization.values[key].icons[value].join(' ')
                            );
                    }
                    return true;
                }
                return false;
            },
            duration: (key, value, node) => {
                var duration = {};
                const intervals = this.localization.values[key].intervals;
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
                node.text(text.charAt(0).toUpperCase() + text.slice(1));
                return true;
            }
        };
        this.cleanup();
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
        resolve();
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

    formatMetricTarget(key, value, node, date, metric) {
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
            node.classed(_.join(_.map(this.norms, spec => spec.classes), '_'),
                false
            );
            const norm = _.find(this.norms,
                spec => spec.condition(value, metric_target)
            );
            node.classed(norm.classes, true)
                .attr('title', norm.title(key, metric_target));
        }
    }

    formatUnitText(key, value) {
        if (!this.defined(value)) {
            return this.locales.message("no-value");
        }
        const unit = this.locales.retrieve(this.localization.short_units,
            key, "%s"
        );
        return vsprintf(unit, [this.formatNumber(value)]);
    }

    formatUnit(key, value, node, svg=false, adjust={}, date=null, metric=[]) {
        const text = this.formatUnitText(key, value);
        if (!this.defined(value)) {
            node.text(text);
            return;
        }
        var done = false;
        if (this.localization.values[key] &&
            this.value_format[this.localization.values[key].type]
        ) {
            done = this.value_format[this.localization.values[key].type](key,
                value, node, text, svg, adjust
            );
        }
        if (date) {
            this.formatMetricTarget(key, value, node, date, metric);
        }
        if (!done) {
            node.text(text);
        }
    }

    formatFeature(key, value, node, svg=false, adjust={}, date=null, metric=[]) {
        if (_.isObject(value)) {
            if (value.min === value.max) {
                value = value.max;
            }
            else {
                const tag = svg ? 'tspan' : 'span';
                node.selectAll(`${tag}.range`).remove();
                node.append(tag)
                    .classed('range', true)
                    .attr('data-message', 'range-value')
                    .selectAll(tag)
                    .data(["min", "max"])
                    .enter()
                    .append(tag)
                    .attr('class', d => d)
                    .each((d, i, nodes) => this.formatUnit(key, value[d],
                        d3.select(nodes[i]), svg, adjust, date, metric
                    ));
                this.locales.updateMessages(node);
                return;
            }
        }

        this.formatUnit(key, value, node, svg, adjust, date, metric);
    }

    getProjectUrl(state, project_key) {
        const project = _.find(state.projects.meta,
            p => p.name === project_key
        );
        if (!project) {
            return this.getIssueUrl(project_key);
        }
        return project.team > 1 ?
            `${config.jira_url}/secure/RapidBoard.jspa?rapidView=${project.team}&view=planning` :
            this.getIssueUrl(project.project_names);
    }

    getIssueUrl(issue_key) {
        return `${config.jira_url}/browse/${issue_key}`;
    }

    getSprintUrl(d) {
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
            sprint_id: first(sprint.sprint_id),
            sprint_ids: _.join(_.concat([], sprint.sprint_id), ',')
        });
        return Mustache.render(template, patterns);
    }
}
