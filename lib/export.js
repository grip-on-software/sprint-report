import _ from 'lodash';
import * as d3 from 'd3';
import axios from 'axios';
import copy from 'copy-to-clipboard';
import JSZip from 'jszip';
import {filterSprints, getRequests, makeRequests, sprintsToFeatures, getSprintMeta} from './data';

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
                this.openLink(url);
            }
        }).catch((error) => {
            d3.select('#error-message')
                .classed('is-hidden', false)
                .text(this.locales.message("error-message", [error]));
            throw error;
        });
    }

    openLink(url) {
        const link = d3.select(document.body)
            .append('a')
            .classed('is-hidden', true)
            .attr('href', url)
            .attr('download', this.filename());
        link.node().click();
        link.remove();
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

class JSON extends Export {
    format(data) {
        const json = window.JSON.stringify(data, null, 4);
        const blob = new Blob([json], {type: 'application/json'});
        return URL.createObjectURL(blob);
    }

    filename() {
        return null;
    }
}

class HTML extends Export {
    build() {
        const {auxiliaryKeys, requests} = getRequests(this.state, {links: true});
        const zip = new JSZip();

        const staticFiles = ['index.html', 'main.css', 'bundle.js'];
        const staticRequests = _.map(staticFiles, file => axios.get(file, {
            responseType: 'text',
            transformResponse: []
        }));

        axios.all(staticRequests).then((staticResponses) => {
            const json = obj => window.JSON.stringify(obj);

            _.forEach(staticFiles, (file, index) => {
                zip.file(file, staticResponses[index].data + (
                    file === 'bundle.js' ? `\x0Adocument.location.hash = ${json(document.location.hash)};` : ''
                ));
            });

            const data = zip.folder("data");
            data.file('projects_meta.json', json(_.filter(this.state.projects.meta,
                project => this.state.projects.selected.has(project.name)
            )));
            data.file('features.json', json(_.omit(_.mapValues(this.state.features,
                features => Array.from(this.state.features.selected.intersect(features))),
                ['known', 'selected']
            )));

            _.forEach(this.localization, (localization, key) => {
                data.file(`${key}.json`, json(localization));
            });

            const sprints = {
                limit: this.state.sprints.limit,
                old: this.state.sprints.showOld,
                closed: this.state.sprints.closed
            };
            data.file('sprints.json', json(sprints));

            requests.then((responses) => {
                const projectRequests = _.zip(Array.from(this.state.projects.selected),
                    _.chunk(responses, auxiliaryKeys.length)
                );
                _.forEach(projectRequests, (project) => {
                    const projectData = data.folder(project[0]);
                    _.forEach(auxiliaryKeys, (key, index) => {
                        projectData.file(`${key === "" ? "default" : key}.json`,
                            json(project[1][index].data)
                        );
                    });
                });

                zip.generateAsync({type: "blob"}).then(blob => {
                    const url = URL.createObjectURL(blob);
                    this.openLink(url);
                });
            });
        });
    }

    filename() {
        return "sprint-report.zip";
    }
}

class Link extends Export {
    build() {
        copy(document.location.href, {
            message: this.locales.message('export-link-copy')
        });
        d3.select('#export-link')
            .classed('tooltip is-tooltip-bottom', true)
            .attr('data-tooltip', this.locales.message('export-link-tooltip'))
            .on('mouseout', function() {
                d3.select(this)
                    .classed('tooltip is-tooltip-bottom', false)
                    .on('mouseout', null);
            });
    }
}

class Print extends Export {
    build() {
        window.print();
    }
}

export default { CSV, JSON, HTML, Link, Print };
