export function getElement(selector, root = document) {
    const element = root.querySelector(selector);

    if (!element) {
        throw new Error(`No se encontró el elemento requerido: ${selector}`);
    }

    return element;
}

export function getOptionalElement(selector, root = document) {
    return root.querySelector(selector);
}

export function setTextContent(element, text) {
    if (element) {
        element.textContent = text;
    }
}

export function setAriaLabel(element, label) {
    if (element) {
        element.setAttribute('aria-label', label);
    }
}

export function toggleClasses(element, classes, shouldAdd) {
    if (!element) {
        return;
    }

    classes.forEach((className) => {
        element.classList.toggle(className, shouldAdd);
    });
}
