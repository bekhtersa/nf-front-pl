import { PlElement, css } from "polylib";
import { ControlledArray, PlaceHolder } from "@plcmp/utils";
import { requestData } from "../lib/RequestServer.js";
import assignDeep from "deep-object-assign-with-reduce";

const reDate = /\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)?/;

class PlDataset extends PlElement {
    static properties = {
        endpoint: {
            type: String
        },
        args: {
            type: Object,
            observer: '_argsChanged'
        },
        executeOnArgsChange: {
            type: Boolean
        },
        executing: {
            type: Boolean,
            value: false
        },
        executingController: {},
        partialData: {
            type: Boolean
        },
        requiredArgs: {
            type: String
        },
        data: {
            observer: '_dataObserver'
        },
        unauthorized: {
            type: Boolean,
            value: false
        }
    }

    static css = css`
        :host {
            display: none;
        }
    `;

    connectedCallback() {
        super.connectedCallback();
        let data = this.data;
        if (!(data instanceof ControlledArray)) {
            data = ControlledArray.from([])
        }
        if (data instanceof ControlledArray) {
            data.load = (x) => this.loadByPlaceHolder(x);
            data.control.partialData = this.partialData
        }
        this.data = data;
    }
    loadByPlaceHolder(placeHolder) {
        this.data.control.range.chunk_start = placeHolder.rn ?? 0;
        this.data.control.range.chunk_end = (placeHolder.rn ?? 0) + 99;
        if (this.data.control.treeMode) {
            this.data.control.treeMode.hidValue = placeHolder[this.data?.control?.treeMode.hidField];
        }
        return this.execute(this._args, { merge: true, placeHolder });
    }
    _argsChanged() {
        if (this.executeOnArgsChange) {
            this.execute(this.args, { executedOnArgsChange: true });
        }
    }
    _dataObserver(val, oldVal, mut) {
        if (mut.path === 'data.sorts') {
            this.execute(this._args);
        }
    }
    prepareEndpointParams(args, control) {
        return assignDeep({
            args: args || this.args || {},
            sqlPath: this.innerText,
            control: {
                partialData: this.partialData,
                sorts: this.data?.sorts,
                filters: this.data?.filters
            }
        }, { control: this.data.control }, { control })
    }

    async execute(args, opts) {
        this._args = args || this.args;
        this.opts = opts
        this.executing = true;
        this.executingController = new AbortController();
        if (!this.pending) {
            this.pending = new Promise(resolve => setTimeout(resolve, 0));
        }
        if (this.result) return this.result;
        this.result = new Promise(async (resolve, reject) => {
            try {
                await this.pending;
                let _args = this._args;
                let partial = this.partialData;

                const {merge, placeHolder, executedOnArgsChange = false, returnOnly, partialData} = this.opts ?? {};
                if(partialData != null) {
                    partial = partialData;
                }
                const reqArgs = this.requiredArgs ? this.requiredArgs.split(';') : [];
                if (reqArgs.length > 0 && (!_args || reqArgs.find(r => _args[r] === undefined || _args[r] === null))) {
                    if (executedOnArgsChange) {
                        this.executing = false;
                        return;
                    }
                    const needArgs = reqArgs.filter(r => !_args || _args[r] === undefined || _args[r] === null).join();
                    throw new Error(`Не переданы обязательные параметры [${needArgs}]`)
                }

                let chunk_start, chunk_end;
                if (partial) {
                    if (!merge && this.data?.control?.range) {
                        this.data.control.range.chunk_start = 0;
                        this.data.control.range.chunk_end = 99;
                    }
                    chunk_start = this.data?.control?.range?.chunk_start ?? 0;
                    chunk_end = this.data?.control?.range?.chunk_end ?? 99;
                    if (this.data?.control?.treeMode && !merge) {
                        this.data.control.treeMode.hidValue = null;
                    }
                }

                let url = this.endpoint;
                if (!url) {
                    if(!this.parentNode) {
                        resolve(ControlledArray.from([]));
                        return;
                    }
                    // значение по умолчанию это fse(formServerEndpoint)
                    const formName = this.parentNode.host.localName.replace('pl-form-','');
                    url = `/@nfjs/front-pl/fse/${formName}/dataset/${this.id}`;
                }
                const req = await requestData(url, {
                    headers: {'Content-Type': 'application/json'},
                    method: 'POST',
                    body: JSON.stringify(this.prepareEndpointParams(_args, {range: {chunk_start, chunk_end}})),
                    unauthorized: this.unauthorized,
                    signal: this.executingController.signal
                });
                const json = await req.json();
                let {data, rowMode, metaData, error} = json;
                if (error) {
                    throw new Error(error);
                }
                // преобразование в формат [{field1:"value",field2:"value"},...]
                if (rowMode === 'array' && metaData) {
                    data = data.map(element => {
                        const newElement = {};
                        metaData.forEach((currField, i) => {
                            newElement[currField.name] = this._convertValueByType(element[i], currField.dataType, currField.dataSubType);
                        });
                        return newElement;
                    });
                }

                if (data.length && this.partialData) {
                    if (data[0]._rn < chunk_start) {
                        if (this.data[data[0]._rn]) {
                            data.shift();
                        } else {
                            data[0] = new PlaceHolder({rn: data[0]._rn ?? chunk_start});
                        }
                    }

                    // По умолчанию при фильтрации в режиме дерева, если не стоит filterByHid то возвращается все дерево, игнорируя chunk start и chunk End
                    // Если для режима дерева стоит filterByHid, то добавляем плейсхолдер и подгружаем записи
                    // Иначе игнорируем
                    if (data[data.length - 1]._rn > chunk_end) {
                        data[data.length - 1] = new PlaceHolder({
                            rn: data[data.length - 1]._rn ?? chunk_end, 
                            [this.data?.control?.treeMode?.hidField]: this.data?.control?.treeMode?.hidValue
                        })
                    }
                }

                if(returnOnly) {
                    resolve({data: data, metaData: metaData});
                    return {data: data, metaData: metaData};
                }

                if (this.data instanceof ControlledArray) {
                    let phIndex = this.data.indexOf(placeHolder);
                    if (phIndex >= 0) {
                        this.splice('data', phIndex, 1, ...data);
                    } else {
                        if (merge) {
                            this.splice('data', this.data.length, 0, ...data);
                        } else {
                            this.splice('data', 0, this.data.length, ...data);
                        }
                    }
                } else {
                    this.data = ControlledArray.from(data);
                }
                resolve(this.data);
            } catch (e) {
                let errorMessage = '';
                if (e instanceof Response) {
                    errorMessage = e.statusText;
                }
                if (e instanceof Error) {
                    errorMessage = e.message;
                }

                document.dispatchEvent(new CustomEvent('toast', { detail: { message: errorMessage, options: { type: 'error', header: 'Ошибка', timeout: 0, icon: 'close-circle' } } }));
                reject(e);
            } finally {
                this.pending = null;
                this.executing = false;
                this.executingController = undefined;
                this.result = null;
            }
        });
        return this.result;
    }

    cancel() {
        if (this.executingController) this.executingController.abort();
    }

    _convertValueByType(value, dataType, dataSubType) {
        if (value === null) {
            return null;
        }

        let val = value;
        switch (dataType) {
            case 'date':
                switch (dataSubType) {
                    case 'date':
                    case 'timestamp':
                        val = value.replace(/(Z|[+-]\d\d(?::\d\d))/, '');
                    case 'timestamptz':
                    default:
                        val = new Date(val);
                        break;
                }
                break;
            case 'numb':
                if (typeof val === 'string' && !Number.isNaN(val)) {
                    val = Number(val);
                }
                break;
            case 'json':
                val = JSON.parse(JSON.stringify(val), (k, v) => {
                    if (v && typeof v === 'string' && reDate.test(v)) {
                        return new Date(v);
                    }
                    return v;
                });
                break;
            default:
                break;
        }
        return val;
    }
}

customElements.define('pl-dataset', PlDataset);
