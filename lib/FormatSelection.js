/**
 * Menu with options to select the format to display the sprint report as.
 *
 * Copyright 2017-2020 ICTU
 * Copyright 2017-2022 Leiden University
 * Copyright 2017-2023 Leon Helwerda
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as d3 from 'd3';
import getUrl from './url';

/**
 * The format selection within the configuration panel.
 */
export default class FormatSelection {
    constructor(state, formatter, locales) {
        this.state = state;
        this.formatter = formatter;
        this.locales = locales;
    }

    makeFormats() {
        const formats = d3.select('#format ul').selectAll('li')
            .data(this.formatter.known);
        const newFormats = formats.enter()
            .append('li')
            .attr('id', d => `format-${d.name}`)
            .classed('tooltip has-tooltip-multiline has-tooltip-bottom', true)
            .attr('data-tooltip', d => this.locales.attribute("format-tooltip", d.name));
        const label = newFormats.append('a');
        label.append('span')
            .classed('icon', true)
            .append('i')
            .attr('class', d => d.icon.join(' '));
        label.append('span')
            .text(d => this.locales.attribute("formats", d.name));

        newFormats.merge(formats)
            .classed('is-active', d => d.name === this.formatter.selected)
            .selectAll('a')
            .attr('href', d => getUrl(this.state, {
                format: [d.name]
            }));
    }
}
