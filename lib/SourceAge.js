import _ from 'lodash';
import * as d3 from 'd3';
import axios from 'axios';
import {Spinner} from '@gros/visualization-ui';

export default class SourceAge {
    constructor(locales, localization) {
        this.locales = locales;
        this.localization = localization;
    }

    build(projects) {
        const sources = d3.select('#sources');
        const table = sources.select('table');
        table.classed('is-loaded', false);
        const sourceSpinner = new Spinner({
            width: sources.node().clientWidth,
            height: 0.8 * sources.node().clientHeight,
            startAngle: 220,
            container: '#sources .spinner',
            id: 'source-age-spinner'
        });
        sourceSpinner.start();
        axios.all(_.map(projects,
            project => axios.get(`data/${project}/sources.json`)
        )).then((responses) => {
            const types = _.keys(this.localization.sources.icon);
            table.classed('is-loaded', true);
            const headers = table.select('thead tr')
                .selectAll('th.project')
                .data(projects, d => d);
            headers.exit().remove();
            headers.enter().append('th')
                .classed('project', true)
                .merge(headers).order()
                .text(d => d);

            const sources = _.filter(_.map(types, type => _.map(responses,
                (response, i) => _.assign({}, {type, project: projects[i]},
                    response.data[type]
                )
            )), data => _.some(data, 'date'));
            const rows = table.select('tbody')
                .selectAll('tr')
                .data(sources, d => d[0].type);
            rows.exit().remove();
            const newRows = rows.enter().append('tr');
            newRows.append('td')
                .text(d => this.locales.retrieve(this.localization.sources, d[0].type));

            const ages = newRows.merge(rows)
                .selectAll('td.age')
                .data(d => d, d => d.project)
                .order();
            ages.exit().remove();
            const newAge = ages.enter().append('td')
                .classed('age', true);
            newAge.append('span')
                .attr('title', d => d.date)
                .text(d => d.date ?
                    this.localization.moment(d.date, "YYYY-MM-DD HH:mm:ss", true).format('ll') :
                    this.locales.message("no-value")
                );
            newAge.append('a')
                .classed('icon is-small', true)
                .attr('href', d => d.url)
                .attr('target', '_blank')
                .attr('aria-label', d => this.locales.message("source-age-label", [
                    this.locales.retrieve(this.localization.sources, d.type),
                    d.project
                ]))
                .append('i')
                .attr('class', d => `${this.localization.sources.icon[d.type].join(' ')} fa-sm`);

            sourceSpinner.stop();
        });
    }
}
