import {filterSprints, makeRequests, sprintsToFeatures} from './data';

class Export {
    constructor(state) {
        this.state = state;
    }

    build() {
        makeRequests(this.state, {
            sprints: sprint => sprint,
            links: true
        }).then((data) => {
            this.format(data);
        }).catch((error) => {
            d3.select('#error-message')
                .classed('is-hidden', false)
                .text(this.locales.message("error-message", [error]));
            throw error;
        });
    }
}

class CSV extends Export {
    format(data) {
        const rows = _.reduce(data, (result, project) => {
            _.forEach(filterSprints(this.state, project.sprints), (sprint) => {
                console.log(sprint);
                result.push(_.concat(project.project_name,
                    _.pick(sprint, this.state.features.selected)
                ));
            });
            return result;
        }, []);
        const blob = new Blob([rows.join('\r\n')], {type: 'text/csv'});
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl);
    }
}

export default { CSV };
