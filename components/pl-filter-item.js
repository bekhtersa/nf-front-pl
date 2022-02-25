import { PlElement, html, css } from "polylib";

class PlFilterItem extends PlElement {
    static get properties() {
        return {
            field: { type: String },
            fieldtype: { type: String },
            value: { type: Object },
            operator: { type: String },
            cast: { type: String }
        }
    }

    static get template() {
        return html`
            <slot></slot>
        `;
    }

    connectedCallback() {
        super.connectedCallback();
        
        this.root.querySelector('slot').assignedElements()[0].addEventListener('value-changed', (event) => {
            this.value = event.detail.value;
            this.notifyChanged();
        });
    }


    notifyChanged() {
        this.dispatchEvent(new CustomEvent('filter-changed', {
            detail: {
                field: this.field,
                fieldtype: this.fieldtype,
                value: this.value,
                operator: this.operator,
                cast: this.cast
            },
            composed: true,
            bubbles: true
        }));
    }

    clear() {
        this.root.querySelector('slot').assignedElements()[0].value = null;
    }
}

customElements.define('pl-filter-item', PlFilterItem);