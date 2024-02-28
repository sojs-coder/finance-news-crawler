const sqlite3 = require("sqlite3").verbose();
const ImageCharts = require('image-charts');


const db = new sqlite3.Database("finance.db");

db.serialize(() => {
    db.all(`SELECT * FROM investments`, (err, rows) => {
        if (err) {
            console.error(err);
        }
        const totalValue = rows.reduce((acc, row) =>{
            return acc + (row.shares * row.basis);
        },0);

        console.log('Total Value Invested:', totalValue);
        const labels = rows.map((row) => row.ticker);
        const data = rows.map((row) => row.shares);
        const chart = ImageCharts()
            .cht('p3') // pie
            .chd('a:' + data.join(','))
            .chl(labels.join('|'))
            .chs('700x700')
            .toFile('pie-chart.png');
        var uniqueLabels = labels.filter((v, i, a) => a.indexOf(v) === i);
        console.log("Invested in", uniqueLabels.length, "different stocks.");
    });
    db.all(`SELECT * FROM moves`,(err, rows) => {
        const sellMoves = rows.filter((row) => row.shares < 0);
        const buyMoves = rows.filter((row) => row.shares > 0);
        console.log("Total Moves:", rows.length);
        console.log("Buy Moves:", buyMoves.length)
        console.log("Sell Moves:", sellMoves.length);
    })
});