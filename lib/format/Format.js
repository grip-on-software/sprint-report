import _ from 'lodash';
import * as d3 from 'd3';
import {vsprintf} from 'sprintf-js';
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
            const value = this.formatNumber(v);
            cell.classed('has-text-right', true).text(vsprintf(templ, [value]));
        };
        const numericDetails = {
            order: 2,
            format: formatDetailsNumber
        };
        this.details = {
            'key': {
                order: 0,
                sort: v => Number(_.last(v.split('-'))),
                format: (cell, v) => cell.append('a')
                    .attr('href', this.getProjectUrl(v))
                    .text(v)
            },
            'title': {
                order: 1,
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
            node.attr('title', this.locales.attribute("sprint_meta", type));
        }
        else {
            type = getSprintMeta(sprint_meta, meta);
            data = data[type];
            if (numeric && sprint_meta.numeric.includes(type)) {
                return data;
            }
        }
        return sprint_meta.format[type](data, node);
    }

    formatFeature(key, value) {
        const unit = this.locales.retrieve(this.localization.short_units,
            key, "%s"
        );
        return value === undefined || value === null ?
            this.locales.message("no-value") :
            vsprintf(unit, [this.formatNumber(value)]);
    }

    getProjectUrl(project_key) {
        return `${config.jira_url}/browse/${project_key}`;
    }

    getSprintUrl(d) {
        return `${config.jira_url}/secure/` + (d.board_id ?
            `GHLocateSprintOnBoard.jspa?sprintId=${d.sprint_id}&rapidViewId=${d.board_id}` :
            `GHGoToBoard.jspa?sprintId=${d.sprint_id}`
        );
    }
}
