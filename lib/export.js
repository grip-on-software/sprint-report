import _ from 'lodash';
import * as d3 from 'd3';
import {filterSprints, makeRequests, sprintsToFeatures, getSprintMeta} from './data';

class Export {
    constructor(locales, localization, state) {
        this.locales = locales;
        this.localization = localization;
        this.state = state;
    }

    filename() {
        return "sprint-report";
    }

    build() {
        makeRequests(this.state, {
            sprints: sprint => sprint,
            links: true
        }).then((data) => {
            const url = this.format(data);
            if (url) {
                const link = d3.select(document.body)
                    .append('a')
                    .classed('is-hidden', true)
                    .attr('href', url)
                    .attr('download', this.filename());
                link.node().click();
                link.remove();
            }
        }).catch((error) => {
            d3.select('#error-message')
                .classed('is-hidden', false)
                .text(this.locales.message("error-message", [error]));
            throw error;
        });
    }
}

class CSV extends Export {
    quote(value) {
        if (typeof value === "undefined" || value === null) {
            value = "";
        }
        value = String(value).replace(/"/g, '""');
        if (value.search(/(?:"|,|\n)/g) >= 0) {
            value = `"${value}"`;
        }
        return value;
    }

    format(data) {
        const meta = getSprintMeta(this.state.sprint_meta, "main");
        const columns = _.concat(this.locales.message("project-name"),
            this.locales.attribute("sprint_meta", meta),
            _.map(Array.from(this.state.features.selected),
                (feature) => this.locales.retrieve(this.localization.descriptions,
                    feature
                )
            )
        );
        const rows = _.concat([columns], _.reduce(data, (result, project) => {
            _.forEach(filterSprints(this.state, project.sprints), (sprint) => {
                result.push(_.concat(
                    project.display_name || project.project_name, sprint[meta],
                    _.map(Array.from(this.state.features.selected),
                        (feature) => sprint[feature]
                    )
                ));
            });
            return result;
        }, []));
        const csv = _.map(rows,
            row => _.map(row, this.quote).join(',')
        ).join('\r\n');
        const blob = new Blob([csv], {type: 'text/csv'});
        return URL.createObjectURL(blob);
    }

    filename() {
        return "sprint-report.csv";
    }
}

export default { CSV };
