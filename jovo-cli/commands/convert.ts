import * as Vorpal from 'vorpal';
import { addBaseCliOptions } from '../utils/Utils';
import { readFileSync, readdirSync, writeFileSync } from 'fs';

module.exports = (vorpal: Vorpal) => {
    const vorpalInstance = vorpal
        .command('convert <fn>')
        // @ts-ignore
        .description('Converts Csv to I18n and vice versa.')
        .option('--from <from>')
        .option('--to <to>');

    addBaseCliOptions(vorpalInstance);

    vorpalInstance
        .validate((args: Vorpal.Args) => {
            return isValidFunction(args.fn) && isValidOrigin(args.options.from);
        })
        .action(async (args: Vorpal.Args) => {
            /**
             * All functions are based on a unified form like this:
             *  {
             *      'en-US': {
             *          key: 'value',
             *          key_arr: ['value1', 'value2']
             *      },
             *      'de-DE': {
             *          key: 'wert'
             *      }
             *  }
             */
            const origin = args.options.from;
            let target = args.options.to;
            target = target ? target.replace(/\/?$/, '/') : target;

            switch (args.fn) {
                case 'i18nToCsv': {
                    try {
                        const csv = toCsv(fromI18N(origin));
                        writeFileSync(`${target || './'}responses.csv`, csv);
                        console.log('Successfully converted I18n to Csv.');
                    } catch (e) {
                        console.log('Something went wrong while convertingfrom I18N. Check the logs below:\n');
                        console.log(e);
                    }
                } break;
                case 'csvToI18n': {
                    try {
                        const model = toI18N(fromCsv(origin)) || {};
                        for (const locale in model) {
                            if (!model.hasOwnProperty(locale)) {
                                continue;
                            }
                            writeFileSync(`${target || './i18n/'}${locale}.json`, JSON.stringify(model[locale], null, '\t'));
                            console.log('Successfully converted Csv to I18n.');
                        }
                    } catch (e) {
                        console.log('Something went wrong while converting from Csv. Check the logs below:\n');
                        console.log(e);
                    }
                } break;
                default: {}
            }
        });
};

function isValidFunction(fn: string) {
    if (['i18nToCsv', 'csvToI18n'].indexOf(fn) === -1) {
        console.log(`The function ${fn} is not supported. Please use one of the following:`);
        console.log('* i18nToCsv\n* csvToI18n');
        return false;
    }
    return true;
}

function isValidOrigin(origin: string) {
    if (!origin) {
        console.log('Orgin has to bet set!');
        return false;
    }
    return true;
}


function fromCsv(path: string) {
    const csv = readFileSync(path, 'utf8').split('\n');
    const [localesStr, ...valueStr] = csv;
    const locales = localesStr.split(',');
    const model: { [key: string]: any } = {};   // tslint:disable-line

    // Delete 'key' from locales
    locales.shift();

    for (const valueS of valueStr) {
        if (!valueS) {
            continue;
        }
        const [key, ...vals] = valueS.split(',');

        // Every row of values (vals) is ordered by locales, so by looping over every locales we can fetch the respective value
        for (const [i, locale] of locales.entries()) {
            if (!model[locale]) {
                model[locale] = {};
            }

            if (!vals[i]) {
                continue;
            }

            const v = model[locale][key];

            // If the current value does yet not exist for the current locale and key, assign it to the key
            if (!v && v !== '') {
                model[locale][key] = vals[i];
                continue;
            }

            // If there already exists a value, either create an array out of the existing and new value or push the new value
            switch (v.constructor) {
                case Array: {
                    if (vals[i] !== '') {
                        v.push(vals[i]);
                    }
                } break;
                case String: {
                    model[locale][key] = [v];
                    if (vals[i] !== '') {
                        model[locale][key].push(vals[i]);
                    }
                } break;
                default: {}
            }
        }
    }
    return model;
}

function toCsv(model: any) {    // tslint:disable-line
    if (!model) {
        throw new Error('Something went wrong!');
    }
    const locales = Object.keys(model);

    const obj: { [key: string]: any } = {};     // tslint:disable-line

    for (const [i, locale] of locales.entries()) {
        const keys = Object.keys(model[locale]);

        /* 
        * Every row in the .csv is simulated in an object by having an array of length=locales.length filled with empty strings.
        * All values are set on their respective position in the array based on the current locale.
        * In the end each array is joined with ',', resulting in comma-seperated strings.
        * e.g. WELCOME,Welcome!,,Willkommen! with locales en-US, en-CA, de-DE where the value for en-CA is empty
        */
        for (const key of keys) {
            const value = model[locale][key] || '';
            switch (value.constructor) {    // tslint:disable-line
                case String: {
                    if (!obj[key]) {
                        obj[key] = new Array(locales.length).fill('');
                    }

                    obj[key][i] = model[locale][key];
                } break;
                case Array: {
                    if (!obj[key]) {
                        obj[key] = [];
                    }

                    // ! WORKAROUND for the case, that a key is a string in one instance and an array in another
                    if (obj[key].length > 0 && obj[key][0].constructor === String) {
                        obj[key] = [obj[key]];
                    }

                    while (obj[key].length < value.length) {
                        obj[key].push(new Array(locales.length).fill(''));
                    }

                    for (const [k, v] of value.entries()) {
                        obj[key][k][i] = v;
                    }
                } break;
                // If the current key is an object, merge the child keys with its parent and write their respective values into the array
                case Object: {
                    for (const k in value) {
                        if (!value.hasOwnProperty(k)) {
                            continue;
                        }
                        const v = value[k];
                        const newKey = `${key}.${k}`;

                        if (!obj[newKey]) {
                            obj[newKey] = new Array(locales.length).fill('');
                        }

                        obj[newKey][i] = v;
                    }
                } break;
                default: {}
            }
        }
    }

    let csv = `key,${locales.join(',')}\n`;
    for (const key in obj) {
        // If the current key holds multiple arrays (the key has multiple occurrences), loop over it and write the key multiple times
        if (obj[key][0].constructor === Array) {
            for (const arr of obj[key]) {
                csv += `${key},${arr.join(',')}\n`;
            }
        } else {
            csv += `${key},${obj[key].join(',')}\n`;
        }
    }

    return csv;
}

function fromI18N(path: string) {
    let files: string[] = [];

    // Workaround for single files
    if (path.indexOf('.json', path.length - 5) !== -1) {
        const pathArr = path.split('/');
        files.push(pathArr.pop()!);
        path = pathArr.join('/');
    } else {
        files = readdirSync(path);
    }

    const model: { [key: string]: any } = {};   // tslint:disable-line
    // For each i18n file, cut out the 'translation' part and push all the keys and their respective values onto the returned model
    files.forEach((locale) => {
        const i18nModel = JSON.parse(readFileSync(`${path}/${locale}`, 'utf8'));
        for (const prop in i18nModel) {
            if (!i18nModel.hasOwnProperty(prop)) {
                continue;
            }

            let obj = i18nModel[prop];
            if (prop !== 'translation') {
                obj = i18nModel[prop]['translation'];
                model[`${locale.replace('.json', '')}-${prop}`] = obj;
            } else {
                model[locale.replace('.json', '')] = obj;
            }
        }
    });
    return model;
}

function toI18N(model: any) {       // tslint:disable-line
    if (!model) {
        throw new Error('Something went wrong!');
    }
    const i18n: { [key: string]: any } = {};     // tslint:disable-line
    // For each locale, push the keys and their respective values onto a new object with a new attribute 'translation' as parent
    for (const locale in model) {
        if (!model.hasOwnProperty(locale)) {
            continue;
        }

        const obj: { [key: string]: any } = {       // tslint:disable-line
            translation: model[locale]
        };

        // If the model includes any platform-specific locales, push them onto the current locale and delete them from the model
        for (const platform of ['AlexaSkill', 'GoogleAction']) {
            const key = `${locale}-${platform}`;
            if (model[key]) {
                obj[platform] = {
                    translation: model[key]
                };
                delete model[key];
            }
        }

        i18n[locale] = obj;
    }
    return i18n;
}