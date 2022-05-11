/**
 * Sprint report formats.
 *
 * Copyright 2017-2020 ICTU
 * Copyright 2017-2022 Leiden University
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
import Table from './format/Table';
import LineChart from './format/LineChart';
import BarChart from './format/BarChart';
import AreaChart from './format/AreaChart';
import ScatterPlot from './format/ScatterPlot';
import SankeyChart from './format/SankeyChart';
import known from './format/known.json';

export default { Table, LineChart, BarChart, AreaChart, SankeyChart, ScatterPlot, known };
