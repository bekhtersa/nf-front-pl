import {css, PlElement} from "polylib";
import {openForm} from "../lib/FormUtils.js";
import './pl-modal-form.js';

class FormThreadManager extends PlElement {
    openedForms = [];
    static properties = {
        currentForm: { type: Object },
        container: { type: Object },
        hidden: { type: Boolean, reflectToAttribute: true }
    }
    connectedCallback() {
        super.connectedCallback();
        this.container = this.container ?? this.root;
    }
    static css = css`
        :host {
          display: block;
          height: 100%;
          width: 100%;
        }
        :host([hidden]) {
          display: none;
        }
    `;
    open(name, options) {
        let drawer;
        if (options?.modal) {
            drawer = document.createElement('pl-modal-form');
            if (options.size) {
                drawer.size = options.size;
            }
            this.root.append(drawer);
        }
        return new Promise( async (resolve,reject) => {
            let form;
            let closeForm = (result) => {
                resolve(result);
                let i = this.openedForms.indexOf(form);
                if (i >= 0) {
                    this.openedForms.splice(i,1);
                    if (!form.hidden) {
                        let ni = Math.min(this.openedForms.length - 1, i);
                        if (ni >= 0) this.openedForms[ni].hidden = false;
                        this.currentForm = this.openedForms[ni]
                    }
                }
                if (this.openedForms.length === 0) {
                    this.notifyEmpty();
                }
                //drawer?.remove();
            }
            try {
                form = await openForm(name, drawer ?? this.container, {
                    params: options.params,
                    _closeCallback: closeForm,
                    formManager: this
                });
                drawer?.open();
                drawer || this.openedForms.forEach(f => {
                    if (!f.hidden) f.hidden = true;
                })
                this.openedForms.push(form);
                if(!drawer) this.currentForm = form;
            } catch (e){
                reject(e);
                document.dispatchEvent(new CustomEvent('error', { detail: { message: `Ошибка загрузки формы ${name}\n ${e}` } }));
                if (this.openedForms.length === 0) {
                    this.notifyEmpty();
                }
            }
        });
    }
    notifyEmpty() {
        this.dispatchEvent( new CustomEvent('pl-form-thread-empty', { bubbles: true, detail: { thread: this.getAttribute('id') } }));
    }
}

customElements.define('pl-forms-thread', FormThreadManager);