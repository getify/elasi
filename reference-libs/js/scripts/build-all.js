#!/usr/bin/env node

var fs = require("fs"),
	path = require("path"),
	util = require("util"),
	{ execFile } = require("child_process"),

	execFileAsync = util.promisify(execFile),
	packageJSON,
	copyrightHeader,
	pkgExports,
	importMapTemplate = {
		imports: {}
	},
	version,
	year = (new Date()).getFullYear(),
	builds,

	ROOT_DIR = path.join(__dirname,".."),
	SRC_DIR = path.join(ROOT_DIR,"src"),
	DIST_DIR = path.join(ROOT_DIR,"dist"),

	result
;

console.log("*** Building ELASI ***");

(async function main(){
	try {
		// try to make the dist directory, if needed
		try {
			fs.mkdirSync(DIST_DIR,0o755);
		}
		catch (err) { }

		// read package.json
		packageJSON = JSON.parse(
			fs.readFileSync(
				path.join(ROOT_DIR,"package.json"),
				{ encoding: "utf8", }
			)
		);
		// read export names from package.json
		pkgExports = packageJSON.exports;
		// read version number from package.json
		version = packageJSON.version;
		// read copyright-header text, render with version and year
		copyrightHeader = fs.readFileSync(
			path.join(SRC_DIR,"copyright-header.txt"),
			{ encoding: "utf8", }
		);
		copyrightHeader = copyrightHeader.replace(/#VERSION#/g,version).replace(/#YEAR#/g,year);

		// run moduloze CLI on the src/ tree
		await execFileAsync(
			path.join(ROOT_DIR,"node_modules",".bin","mz"),
			[
				`--prepend=${ copyrightHeader }`,
				"-ruben",
			]
		);

		// build import-map template
		for (let [ exportPath, exportEntry ] of Object.entries(pkgExports)) {
			let fromPath = exportPath.replace(/^\./,"elasi");
			let toPath = exportEntry.import.replace(/^\.\/dist\/esm/,"/elasi");
			importMapTemplate.imports[fromPath] = toPath;
		}
		// write out import-map template file
		fs.writeFileSync(
			path.join(DIST_DIR,"esm","import-map-template.json"),
			JSON.stringify(importMapTemplate,null,"  "),
			"utf8"
		);

		console.log("Complete.");
	}
	catch (err) {
		console.error(err);
		process.exit(1);
	}
})();
