const fs = require('fs');
const pngToIco = require('png-to-ico');

console.log('pngToIco type:', typeof pngToIco);
console.log('pngToIco value:', pngToIco);

if (typeof pngToIco !== 'function') {
    if (pngToIco.default && typeof pngToIco.default === 'function') {
        console.log('Using pngToIco.default');
        pngToIco.default('resources/icon.png')
            .then(buf => {
                fs.writeFileSync('resources/icon.ico', buf);
                console.log('Icon converted successfully');
            })
            .catch(console.error);
    } else {
        console.error('Module is not a function and has no default function');
    }
} else {
    pngToIco('resources/icon.png')
        .then(buf => {
            fs.writeFileSync('resources/icon.ico', buf);
            console.log('Icon converted successfully');
        })
        .catch(console.error);
}
