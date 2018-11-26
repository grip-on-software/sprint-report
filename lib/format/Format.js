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
        this.formatNumber = d3.formatLocale(this.locales.selectedLocale)
            .format("~r");
        const formatDetailsNumber = (cell, v, key) => {
            const templ = this.locales.retrieve(this.localization.short_units,
                key, '%s'
            );
            const value = v === "NA" ? "\u2014" : this.formatNumber(v);
            cell.classed('has-text-right', true).text(vsprintf(templ, [value]));
        };
        const numericDetails = {
            order: 2,
            type: 'numeric',
            format: formatDetailsNumber
        };
        this.details = {
            'key': {
                order: 0,
                sort: v => Number(_.last(v.split('-'))),
                format: (cell, v) => cell.append('a')
                    .attr('href', this.getIssueUrl(v))
                    .text(v)
            },
            'title': {
                order: 1,
                type: 'alpha'
            },
            'story_points': numericDetails,
            'domain_name': {
                order: 1
            },
            'avg_value': numericDetails,
            'end_value': numericDetails,
            'max_value': numericDetails,
            'min_value': numericDetails,
            'sum_value': numericDetails
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

    build(state, spinner) {
        this.content.classed('is-loaded', false);
        spinner.start();
        return new Promise((resolve, reject) => {
            makeRequests(state, {
                sprints: this.orderSprints,
                links: true
            }).then((data) => {
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
        node = d3.select(node);
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

    formatFeature(key, value) {
        const unit = this.locales.retrieve(this.localization.short_units,
            key, "%s"
        );
        return value === undefined || value === null ?
            this.locales.message("no-value") :
            vsprintf(unit, [this.formatNumber(value)]);
    }

    getProjectUrl(state, project_key) {
        const project = _.find(state.projects.meta,
            p => p.name === project_key
        );
        return project && project.team > 1 ?
            `${config.jira_url}/secure/RapidBoard.jspa?rapidView=${project.team}&view=planning` :
            this.getIssueUrl(project_key);
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
