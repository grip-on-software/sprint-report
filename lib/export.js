import _ from 'lodash';
import * as d3 from 'd3';
import axios from 'axios';
import copy from 'copy-to-clipboard';
import JSZip from 'jszip';
import config from 'config.json';
import {vsprintf} from 'sprintf-js';
import {filterSprints, getRequests, makeRequests, sprintsToFeatures, getSprintMeta} from './data';

class Export {
    constructor(locales, localization, state) {
        this.locales = locales;
        this.localization = localization;
        this.state = state;
        this.url = null;
    }

    getUrlSelection() {
        return {};
    }

    setCurrentUrl(url) {
        this.url = url;
    }

    filename() {
        return "sprint-report";
    }

    requestConfig() {
        return {sprints: sprint => sprint};
    }

    build(button) {
        makeRequests(this.state, this.requestConfig()).then((data) => {
            const url = this.format(data);
            if (url) {
                this.openLink(url);
            }
            button.classed('is-loading', false);
        }).catch((error) => {
            d3.select('#error-message')
                .classed('is-hidden', false)
                .text(this.locales.message("error-message", [error]));
            throw error;
        });
    }

    openLink(url, target=null) {
        const link = d3.select(document.body)
            .append('a')
            .classed('is-hidden', true)
            .attr('target', target)
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

class JSONSource extends Export {
    requestConfig() {
        return _.assign({}, super.requestConfig(), {
            links: true,
            details: true,
            sources: true
        });
    }

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
    json(obj) {
        return window.JSON.stringify(obj);
    }

    build(button) {
        this.zip = new JSZip();

        const promises = [
            new Promise((resolve, reject) => this.writeStatic(resolve, reject)),
            new Promise((resolve, reject) => this.writeManifest(resolve, reject)),
            new Promise((resolve, reject) => this.writeProject(resolve, reject))
        ];

        Promise.all(promises).then(() => {
            this.zip.generateAsync({type: "blob"}).then(blob => {
                const url = URL.createObjectURL(blob);
                this.openLink(url);
                this.zip = null;
                button.classed('is-loading', false);
            });
        }).catch(error => {
            button.classed('is-loading', false)
                .classed('is-tooltip-danger is-tooltip-multiline', true)
                .attr('data-tooltip', this.locales.message("error-message", [error]));
        });
    }

    writeStatic(resolve, reject) {
        const staticFiles = ['index.html', 'main.css', 'bundle.js'];
        const staticRequests = _.map(staticFiles, file => axios.get(file, {
            responseType: 'text',
            transformResponse: []
        }));

        axios.all(staticRequests).then((staticResponses) => {
            _.forEach(staticFiles, (file, index) => {
                this.zip.file(file, staticResponses[index].data + (
                    file === 'bundle.js' ? `\x0Adocument.location.hash = ${this.json(this.url)};` : ''
                ));
            });

            const data = this.zip.folder("data");
            data.file('projects_meta.json', this.json(_.filter(this.state.projects.meta,
                project => this.state.projects.selected.has(project.name)
            )));
            data.file('features.json', this.json(_.mapValues(
                _.omit(this.state.features,
                    ['known', 'selected', 'visible', 'expressions', 'format']
                ),
                features => Array.from(this.state.features.selected.intersect(features))
            )));
            data.file('expressions.json',
                this.json(this.state.features.expressions)
            );

            _.forEach(this.localization, (localization, key) => {
                data.file(`${key}.json`, this.json(localization));
            });

            const sprints = {
                limit: this.state.sprints.limit,
                old: this.state.sprints.showOld,
                closed: this.state.sprints.closed
            };
            data.file('sprints.json', this.json(sprints));

            resolve();
        }).catch(error => {
            reject(error);
        });
    }

    writeManifest(resolve, reject) {
        axios.get('manifest.json').then(manifest => {
            this.zip.file('manifest.json', this.json(manifest.data));

            const manifestPaths = _.values(_.pickBy(manifest.data,
                path => path.substring(0, 1) !== '/'
            ));
            const manifestRequests = _.map(manifestPaths,
                path => axios.get(path, {
                    responseType: 'text',
                    transformResponse: []
                })
            );
            axios.all(manifestRequests).then((manifestResponses) => {
                _.forEach(manifestPaths, (path, index) => {
                    this.zip.file(path.split('?', 1),
                        manifestResponses[index].data
                    );
                });

                resolve();
            }).catch(error => {
                reject(error);
            });
        }).catch(error => {
            reject(error);
        });
    }

    writeProject(resolve, reject) {
        const {auxiliaryKeys, requests} = getRequests(this.state, {
            links: true,
            details: true,
            sources: true
        });
        requests.then((responses) => {
            const projectRequests = _.zip(Array.from(this.state.projects.selected),
                _.chunk(responses, auxiliaryKeys.length)
            );
            const data = this.zip.folder("data");
            _.forEach(projectRequests, (project) => {
                const projectData = data.folder(project[0]);
                _.forEach(auxiliaryKeys, (key, index) => {
                    projectData.file(`${key === "" ? "default" : key}.json`,
                        this.json(project[1][index].data)
                    );
                });
            });

            resolve();
        }).catch(error => {
            reject(error);
        });
    }

    getUrlSelection() {
        return {config: ['0']};
    }

    filename() {
        return "sprint-report.zip";
    }
}

class Link extends Export {
    build(button) {
        const locales = this.locales;
        button.classed('tooltip is-tooltip-info', true)
            .attr('data-tooltip', locales.message('export-link-tooltip'));
        copy(document.location.href, {
            message: this.locales.message('export-link-copy')
        });
        button.classed('is-loading', false)
            .on('mouseout', function() {
                button.classed('is-tooltip-info', false)
                    .attr('data-tooltip', locales.attribute('export_tooltip', 'link'))
                    .on('mouseout', null);
            });
    }
}

class Print extends Export {
    build(button) {
        window.print();
        button.classed('is-loading', false);
    }
}

class PDF extends Export {
    build(button) {
        const projects = Array.from(this.state.projects.selected).join(', ');
        const query = encodeURIComponent(`?lang=${this.locales.lang}`);
        const url = vsprintf(config.render_url, [
            `${config.visualization_url}sprint-report/${query}${encodeURIComponent(this.url)}`,
            projects === '' ? this.locales.message("title") :
                this.locales.message("title-projects", [projects])
        ]);
        this.openLink(url, '_blank');
        button.classed('is-loading', false);
    }
}

export default { CSV, JSONSource, HTML, Link, Print, PDF };
