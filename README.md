Namen tega projekta je bil sestaviti osnovni 3-dimenzionalni pregledovalnik. Osrednjega pomena pri temu projektu sta bila samo prikazovanje 3D podatkov s pomočjo knjižnice CesiumJS ter sodelovanje oz. sinhronizacija 3D zemljevida z (že obstoječim) 2D zemljevidom.

Za bolj pregleden prikaz te datoteke predlagam program Obsidian.

# 1. Navodila za zagon

Odpremo `cmd.exe` in se z ukazom `cd` prestavimo v mapo `slovenia-map`. Nato uporabimo ukaz `npm run dev`, kar požene web development tool Vite. Kot odziv prejmemo:
```
  VITE v8.2.1  ready in 1406 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```
V spletnem brskalniku obiščemo URL `http://localhost:5173/` (oz. morda so številke drugačne), na katerem najdemo 2D/3D pregledovalnik.

# 2. Opis funkcionalnosti projekta

Seznam datotek:
* main.js
* olMapInit.js
* cesiumMapInit.js
* syncMaps.js
* syncButton.js (morda izbrisana, saj ni več uporabna)
* pointMode.js
* lineMode.js
* layerControls.js
* style.css
* index.html
* generateLayersManifest.mjs
* shp_to_geojson.py
* drape_geojson_on_pointcloud.py

## 2.1 Kratek opis delovanja

V `cmd.exe` v directoryju `C:\Users\matej.safaric\Documents\LUZ\slovenia-map` uporabimo ukaz `npm run dev`, s katerim s pomočjo frontend build orodja Vite poženemo lokalni strežnik.

Nato v brskalnik vpišemo URL: http://localhost:5173/ (morda so številke drugačne).

Pred nami je 2D zemljevid, ki temelji na knjižnici OpenLayers. Program je vnaprej nastavljen tako, da se pokaže eden izmed layerjev, ki so shranjeni v mapi public/data/layers2D. Na desni imamo na voljo več gumbov:
* Show 3D
* Enter Point mode
* Enter Line mode
* Gumbi za izbor layerja (če pritisnemo gumb layerja, ki ga že vidimo, se nič ne zgodi)
* Gumbi za razne dodatne layerje v 3D pogledu 

Gumbi za Point mode, Line mode in gumbi za razne dodatne layerje v 3D ne počnejo ničesar dokler 3D zemljevid ni viden. Da prižgemo 3D pogled, pritisnemo gumb "Show 3D". Ko je 3D pogled odprt, lahko uporabimo Point ali Line mode:

1. Point mode: s klikanjem po 3D zemljevidu postavljamo obarvane točke, ki se potem prikažejo tudi na 2D zemljevidu
2. Line mode: s klikanjem po 3D zemljevidu postavljamo obarvane točke, ki jih povezuje polyline. Vse narisane objekte lahko nato vidimo tudi na 2D zemljevidu.

*Pripomba*: Možno je hkrati biti v Point in Line mode-u, kar je napaka. 

S pritiskom na gumbe v zadnjem sklopu gumbov prižigamo in ugašamo razne sloje 3D podatkov, kot so ceste v MOL, večje ceste po Sloveniji, mreže stavb MOL ter kubusi stavb MOL:
1. Roads MOL: prikaže ceste v Ljubljani, ki ležijo na istem območju enega kvadratnega kilometra kot oblak točk. Prvotno so bili podatki o teh cestah zapisani v formatu GeoJSON in so vsebovali le podatke za prikaz v dveh dimenzijah. S pomočjo Python programa `drape_geojson_on_pointcloud.py` smo tem podatkom dodelili 3D koordinate tako, da so ceste položene na oblak točk.
2. Roads OS DC 2026: prikaže vse večje ceste po Sloveniji. Podatki o teh cestah so že od samega začetka bili shranjeni kot 3D podatki, le da so bili zapisani v Shapefile formatu. Za njihov prikaz jih je bilo potrebno preoblikovati v GeoJSON format s pomočjo programa `shp_to_geojson.py`, saj CesiumJS ne podpira formata Shapefile direktno.
3. Polygons: funkcionalnost tega gumba je, da prikaže kubuse stavb v središču Ljubljane. Prikaz temelji na prvotnih podatkih, ki so zapisani v Shapefile formatu in vsebujejo 2D podatke o poligonih z dodatnimi atributi, ki opisujejo nekatere lastnosti o legi poligonov v 3D prostoru (npr. razne višinske podatke). 
4. Draped mesh (ne deluje najbolje): načrtovana funkcionalnost tega gumba je bila, da poligone iz iste Shapefile datoteke kot prejšnja alineja položi čez oblak točk podobno kot ceste pri prvi alineji. Problem je, da je ta implementacija zelo računsko zahtevna in ne moremo prikazati več kot le nekaj stavb brez hudega upočasnjenja računalnika. To se zgodi zaradi potrebe po triangulaciji vsakega poligona, ki ga želimo položiti čez oblak.  

Če želimo zapreti 3D pogled, pritisnemo "Hide 3D".

## 2.2 Opis datotek

Sledi približen opis vsake datoteke v projektu ter njene vloge pri delovanju projekta.

###### index.html in style.css
Samoumevno, pač HTML in CSS datoteki, ki sta osnova za spletno stran

###### main.js
Glavna datoteka, ki jo požene `index.html`, ki se potem povezuje z ostalimi moduli. Vsebuje big-picture strukturo sistema

###### olMapInit.js
Datoteka, ki pripravi 2D zemljevid za prikaz in naloži podatke iz datoteke `manifest.json` (le-ta se nahaja v isti mapi kot podatki, namreč v `layers2D`)

###### cesiumMapInit.js
Datoteka, ki pripravi 3D zemljevid, podobno kot `olMapInit.js` za 2D zemljevid. Glavna strukturna razlika (poleg očitne razlike v knjižnicah OpenLayers in Cesium) je, da je celotna datoteka v obliki funkcije, ki se pokliče, ko uporabnik klikne na gumb "Show 3D".

###### syncMaps.js
Vsebuje le funkcijo `setupMapSync`, ki poveže 2D in 3D zemljevida tako, da premiki enega spremenijo tudi pogled drugega. Funkcija vrne funkciji `enable()` in `disable()`, ki sta lahko uporabljeni za vklop ali izklop sinhronizacije zemljevidov.
###### syncButton.js
Ta datoteka ni več uporabna in se lahko izbriše (če je ob branju sploh še prisotna). Vsebuje kodo za gumb Sync 3D to 2D, ki je pogled 3D zemljevida nastavila na enak pogled, kot ga ima 2D zemljevid ob trenutku klika. Ta koda je bila predvsem uporabna za usklajevanje zemljevidov takrat, ko le-ti še niso bili povsem usklajeni in je tveganje podivjane kamere še bilo možno.
###### pointMode.js in lineMode.js
Datoteki sta dovolj podobni, da ju obravnavamo skupaj. Razlikujeta se le v kodi, ki določa risanje točk in črt ter v funkciji `pickNearestPointCloudHit`, ki poišče točko v oblaku, ki jo gleda 3D kamera (oz. točko, ki je najboljši približek). 
###### layerControls.js
Vsebuje le funkcijo, ki naredi toliko gumbov na HTML strani, kot je layerjev v datoteki `manifest.json`.
###### generateLayersManifest.mjs
Pregleda datoteko `layers2D` in pripravi datoteko manifest.json, ki jo nato potrebujejo ostale datoteke za prikaz 2D podatkov.

###### shp_to_geojson.py
Python koda, ki omogoča uporabniku, da v `cmd.exe` pretvori Shapefile datoteke (bodisi datoteke `shp` bodisi `.zip` mape) v GeoJSON datoteke. Več o njenem delovanju bralec najde v razdelku **Konverzija podatkov: Shapefile**.

###### drape_geojson_on_pointcloud.py
Python koda, ki omogoča uporabniku, da v `cmd.exe` ob podanem oblaku točk v formatu `.laz` GeoJSON datoteke, ki vsebujejo le 2D informacije, opremi tudi s 3D podatki tako, da so dobljeni GeoJSON podatki "položeni" na oblak točk. Več o njenem delovanju in uporabi bralec najde v razdelku **Delovanje kode: drape_geojson_on_pointcloud.py**.

# 3. Osnove CesiumJS

## 3.1 Objekt `Viewer`

Osrednji objekt s katerim delamo v Cesiumu je `Viewer`. Enostaven primer kode, ki naredi privzeti zemljevid Zemlje:

```javascript
import {
  Viewer,
  Ion,
} from "cesium";

import "cesium/Build/Cesium/Widgets/widgets.css";

const viewer = new Viewer("map-3d", {
  animation: false,
  timeline: false,
});
```

V zgornji kodi je privzeta vrednost `true` pri lastnosti `viewer.globe`. Če to vrednost nastavimo na `false`, bo na zemljevidu izginil globus Zemlje. To smo naredili v implementaciji prikazovalnika, da globus ne bi bil v napoto prikazu 3D podatkov slovenije.

## 3.2 Dodajanje podatkov

Ko želimo dodati svoje podatke v prikazovalnik, imamo na voljo več razredov, ki služijo temu namenu. Vsak je dober za svoje namene. Tu omenimo dva primera, ki sta prišla prav pri tem projektu.

### 3.2.1 Razred `DataSource`

Ta razred pride prav, ko delamo z nabori preprostih likov, kot so točke, daljice, poligoni oz. drugi preprosti objekti. Obstaja več podvrst `DataSource` objektov. Če želimo npr. prikazati podatke, ki so prvotno shranjeni v formatu GeoJSON, lahko uporabimo razred `GeoJsonDataSource`. Primer kode:

```javascript
import {
  GeoJsonDataSource,
  Color,
} from "cesium";

const source = GeoJsonDataSource.load("data.geojson", {
	stroke: Color.RED,
	fill: Color.RED.withAlpha(0.4),
	strokeWidth: 2,
	}
)

viewer.dataSources.add(source);
```

Takemu objektu lahko med drugim dodelimo tudi ime. Z zgornjo kodo tega ne moremo direktno narediti, saj funkcija `GeoJsonDataSource.load` vrne `Promise` objekt, ki nima lastnosti `name`. Želeno funkcionalnost torej dobimo na naslednji način: 

```javascript
const source = GeoJsonDataSource.load("data.geojson", {
	stroke: Color.RED,
	fill: Color.RED.withAlpha(0.4),
	strokeWidth: 2,
	}
).then((source_variable) => {
	source_variable.name = "ŽELENO IME ZA SOURCE";
	viewer.dataSources.add(source_variable);
});
```

Omenimo, da v prejšnji različici kode ne dobimo errorja ko kličemo funkcijo `viewer.dataSources.add`, saj ta funkcija lahko prejme kot argument tudi objekt tipa `Promise` in v tem primeru počaka, da se `Promise` izpolni, in šele nato doda dobljeni `DataSource` objekt v `viewer`.

Dodatno komentirajmo, da je lastnost `name` pogosto že sama dodeljena objektu `DataSource`, ko je to možno. Dodeljeno ime je običajno pridobljeno kar iz imena datoteke. V našem primeru bi torej ime lahko postalo `"data.geojson"`.

Podobno kot smo naredili z lastnostjo `name`, lahko naredimo z drugimi lastnostmi, kot je npr. lastnost `show`, ki določa vidljivost tega vira v viewerju.

#### Komentar glede `GeoJsonDataSource.load` in `fetch`
Na parih mestih v kodi datoteke `cesiumMapInit.js` namesto funkcije `GeoJsonDataSource.load` uporabimo funkcijo `fetch`. Primer:

```javascript
const roads_OS_DC_GeoJSONSource = fetch(GEOJSON_PATH_OS_DC)
	.then((response) => response.json())
	.then((geojson) => {
		if (!geojson.crs) {
			geojson.crs = {
				type: "name",
				properties: { name: "urn:ogc:def:crs:EPSG::3794" },
			};
		}
		return GeoJsonDataSource.load(geojson, {
			stroke: Color.RED,
			fill: Color.RED.withAlpha(0.4),
			strokeWidth: 2,
			show: false,
			clampToGround: false,
		})
		.then((roads_OS_DC_GeoJSONSource) => {
			roads_OS_DC_GeoJSONSource.name = "roads_OS_DC_GeoJSONSource";
			viewer.dataSources.add(roads_OS_DC_GeoJSONSource);
			roads_OS_DC_GeoJSONSource.show = false;
		});
	})
```

V takih primerih smo uporabili funkcijo `fetch` zato, da lahko GeoJSON malce dopolnimo po potrebi preden ga pretvorimo v `DataSource` objekt. V zgornji kodi npr. smo to naredili, ker GeoJSON datoteka morda ni vsebovala informacij o svojem koordinatnem sistemu in smo te podatke nato ročno nastavili z ukazi:
```javascript
geojson.crs = {
	type: "name",
	properties: { name: "urn:ogc:def:crs:EPSG::3794" },
};
```

### 3.2.2 Razred `Cesium3DTileset`

Ta razred se uporablja, kot nam že samo ime pove, za prikaz 3D Tiles podatkov. Slednji format pride prav za zapisovanje oblakov točk. Preprosta koda, ki prikaže take podatke je podana spodaj.

```javascript
const tileset = await Cesium.Cesium3DTileset.fromUrl( "/path/to/tileset.json" ); viewer.scene.primitives.add(tileset); 

viewer.zoomTo(tileset);
```

Zadnja funkcija `viewer.zoomTo` le poskrbi, da se pogled pregledovalnika takoj postavi tako, da vidimo naše podatke.

#### Kako izboljšati performance

V dejanskem projektu smo dodali veliko kode, katere naloga je izboljšati performance programa. Oblaki točk, ki jih uporabljamo, imajo namreč več milijonov točk, zato si želimo, da se ne prikazuje vseh teh točk naenkrat. Vse trike, ki smo jih uporabili, tu razložimo.

Vsa spodnja koda se nahaja v datoteki `cesiumMapInit.js`.

Za začetek naložimo objekt `Cesium3DTileset` z dodatnimi nastavitvami glede LOD (level of detail) optimizacije: 
```javascript
        const tileset = await Cesium3DTileset.fromUrl(
            "/pointcloud/tiles/tileset.json",
            {
                // Start coarse so the first frame appears quickly,
                // then Cesium refines tiles as the camera settles.
                maximumScreenSpaceError: 64,
  
                // Cap GPU memory usage; distant tiles are evicted
                // automatically when this limit is approached.
                // Tune upward (1024+) on high-RAM machines.
                maximumMemoryUsage: 512,
  
                // Show a coarse version immediately instead of
                // waiting for the full hierarchy to be parsed.
                skipScreenSpaceErrorUntilReady: true,
                skipLevelOfDetail: false,
  
                // Point cloud visual quality
                pointCloudShading: {
                    attenuation: true,       // points shrink with distance
                    maximumAttenuation: 3,   // max point size in pixels
                    geometricErrorScale: 1.0,
                },
            }
        );

        viewer.scene.primitives.add(tileset);
        _pointCloudTileset = tileset;
```

Ključnega pomena v tem delu kode je pojem *Screen Space Error* oziroma *SSE*. Ta podatek opisuje, v kolikšni meri se dejanski 3D podatki razlilkujejo od tega, kar je prikazano na zaslonu. Ko nastavimo parameter `maximumScreenSpaceError: 64`, s tem dopuščamo, da je prikazana slika mnogo bolj groba, kot če bi prikazali vse točke v oblaku. V kasnejših sklopih kode bomo videli, da s spreminjanjem tega parametra lahko določamo grobost prikazanega oblaka točk. 

Večina parametrov zgoraj ima že podane komentarje, ki razložijo, kaj vsak parameter počne, zato omenimo le še parameter `geometricErrorScale`. Ta parameter sodeluje pri računanju velikosti točk oblaka. Ker imamo nastavljeno `attenuation: true`, to pomeni, da na vsakem koraku Cesium izračuna, kako velike naj bodo točke s pomočjo podatka `geometricError` (in raznih drugih podatkov, ki so manj pomembni). Parameter `geometricErrorScale` torej določa, kako močno naj `geometricError`vpliva na velikost točk. Njegova privzeta vrednost je običajno kar `1.0`, zato je ta del kode v resnici nepotreben. Vseeno je prisoten, da ga lahko po potrebi spremenimo.

V naslednji fazi nalaganja oblaka točk določimo, kako naj se `maximumScreenSpaceError` spreminja z višino/oddaljenostjo kamere od oblaka:
```javascript
viewer.scene.postRender.addEventListener(() => {
	if (!_pointCloudTileset) return;

	const height = viewer.camera.positionCartographic.height - 281.68;

	let targetSSE;
	if      (height > 3_000)  targetSSE = 64;  // far overview 
	else if (height > 1_500)  targetSSE = 24;   // mid overview
	else if (height > 800)    targetSSE = 8;   // start seeing neighborhoods
	else if (height > 300)    targetSSE = 4;   // neighborhood detail
	else if (height > 100)    targetSSE = 2;    // street-level
	else if (height > 30)     targetSSE = 0;    // close inspection
	else                      targetSSE = 0;    // extreme close-up

	// Smooth lerp toward target so SSE doesn't jump abruptly
	_pointCloudTileset.maximumScreenSpaceError = lerp(
		_pointCloudTileset.maximumScreenSpaceError,
		targetSSE,
		0.1   // blend factor — increase for snappier response
	);
});

// ── Helper ─────────────────────────────────────────────────────
function lerp(a, b, t) {
	return a + (b - a) * t;
}
```

Najprej par komentarjev glede konteksta, v katerem je ta koda nastala. Vrednosti parametrov v tej kodi so izbrane glede na oblak točk, ki predstavlja območje velikosti enega kvadratnega kilometra. Prav tako je ta oblak točk prikazoval del Ljubljane, zato smo pri računu razdalje med kamero in oblakom odšteli nadmorsko višino Ljubljane.

Za bolj tekoče prehajanje med različnimi vrednostmi `maximumScreenSpaceError` smo uporabili funkcijo `lerp`, ki linearno interpolira med dvema vrednostima.

Nazadnje dodamo sistem, ki ob padcu framerate-a poveča `maximumScreenSpaceError` zato, da si pregledovalnik lahko opomore:
```javascript
let frameCount = 0;
let lastFPSSample = performance.now();

viewer.scene.postRender.addEventListener(() => {
	if (!_pointCloudTileset) return;

	frameCount++;
	const now = performance.now();

	if (now - lastFPSSample >= 1_000) {
		const fps = frameCount;
		frameCount = 0;
		lastFPSSample = now;

		if (fps < 30) {
			// Raise SSE cap — load fewer tiles
			_pointCloudTileset.maximumScreenSpaceError = Math.min(
				256,
				_pointCloudTileset.maximumScreenSpaceError * 1.4
			);
		}
	}
});
```

Proces povrnitve k nižjemu SSE je zagotovljen s strani prejšnjega odseka kode. Ta koda zagotovi le, da se `maximumScreenSpaceError` primerno poveča glede na trenuten FPS.

# 4. Development infrastruktura z Vite

Za lokalno razvijanje spletne strani uporabljamo Vite (frontend build tool). V mapi, kjer želimo narediti projekt uporabimo (v `cmd.exe`) naslednje ukaze: 

```
npm create vite@latest IME_PROJEKTA -- --template vanilla 
cd IME_PROJEKTA
npm install 
```

Ti ukazi naredijo novo mapo z imenom, ki je enako imenu projekta, v kateri lahko nato razvijamo spletno stran. Za zagon lokalne spletne strani potem v cmd.exe vpišemo `npm run dev`. Po izvršitvi tega ukaza dobimo URL (običajno nekaj podobnega `http://localhost:5173/`), na katerem se nahaja naš projekt.

### Morebitni troubeshooting

Cesium in Vite nista povsem zadovoljna drug z drugim, zato je morda treba namestiti plug-in, ki poskrbi za njuno usklajenost.

```
npm uninstall vite-plugin-static-copy
npm install -D vite-plugin-cesium
```

Poleg teh dveh ukazov ustvarimo še datoteko `vite.config.js` v mapi projekta, ki vsebuje naslednjo JavaScript kodo.

```javascript
import { defineConfig } from "vite";
import cesium from "vite-plugin-cesium";

export default defineConfig({
  plugins: [cesium()],
});
```




# 5. Konverzija podatkov

CesiumJS ima vgrajeno podporo za nekatere formate geografskih podatkov, kot sta npr. GeoJSON in 3D Tiles, o katerih smo že govorili. Žal pa ta podpora ne zaobjema vseh formatov, vključno z nekaterimi precej standardnimi. V tem poglavju pokrijemo pretvorbo dveh takih formatov, namreč Shapefile in LAZ.

## 5.1 LAZ 

Oblaki točk, ki jih lahko najdemo na https://ipi.eprostor.gov.si/jv/ ali https://clss.si/, so zapisani v formatu `.laz`. Eden izmed načinov, kako lahko take podatke prikažemo s knjižnico Cesium, je, da uporabimo Python knjižnico `py3dtiles`, ki jih pretvori v format 3D Tiles. Za primer bomo tu obravnavali podatke tipa GKOT (georeferenciran klasificiran oblak točk), ki se jih dobi na zgoraj navedenih URL-jih v formatu `.laz`. CRS teh podatkov je EPSG:4978. To lahko vidimo, če s pomočjo Python knjižnice izvedemo naslednjo kodo: 
```python
import laspy
laz = laspy.read('GKOT.laz')
print(f.header.parse_crs())
```

Dobimo izpis: 
```
PROJCRS["Slovenia 1996 / Slovene National Grid",BASEGEOGCRS["Slovenia 1996",DATUM["Slovenia Geodetic Datum 1996",ELLIPSOID["GRS 1980",6378137,298.2572221,LENGTHUNIT["metre",1,ID["EPSG",9001]],ID["EPSG",7019]],ID["EPSG",6765]],ID["EPSG",4765]],CONVERSION["Slovene National Grid",METHOD["Transverse Mercator",ID["EPSG",9807]],PARAMETER["Latitude of natural origin",0,ANGLEUNIT["degree",0.0174532925199433,ID["EPSG",9102]]],PARAMETER["Longitude of natural origin",15,ANGLEUNIT["degree",0.0174532925199433,ID["EPSG",9102]]],PARAMETER["Scale factor at natural origin",0.9999,SCALEUNIT["unity",1,ID["EPSG",9201]]],PARAMETER["False easting",500000,LENGTHUNIT["metre",1,ID["EPSG",9001]]],PARAMETER["False northing",-5000000,LENGTHUNIT["metre",1,ID["EPSG",9001]]],ID["EPSG",19845]],CS[Cartesian,2,ID["EPSG",4400]],AXIS["Easting (E)",east],AXIS["Northing (N)",north],LENGTHUNIT["metre",1,ID["EPSG",9001]],ID["EPSG",3794]]
```

Na koncu tega izpisa vidimo `ID["EPSG",3794]`, kar nam pove, da je to CRS naših podatkov. Namesto, da razberemo CRS ročno, lahko tudi poženemo naslednjo Python kodo.
```python
crs = laz.header.parse_crs()

if crs is not None:
    print("CRS name:", crs.name)
    print("EPSG code:", crs.to_epsg())
else:
    print("No CRS found in the LAS header.")
```

V večini primerov naj bi ta koda delovala.
### Knjižnica py3dtiles

Knjižnica `py3dtiles` za svoje delovanje potrebuje starejšo različico Pythona, npr. Python 3.12.x. Pretvorbe se lahko lotimo v virtualnem okolju Python, ki ga inicializiramo z ukazom
```
py -3.12 -m venv IME_VIRTUALNEGA_OKOLJA
```

Virtualno okolje aktiviramo z ukazom `IME_VIRTUALNEGA_OKOLJA\Scripts\Activate`. Ko smo enkrat v virtualnem okolju lahko kličemo funkcije `py3dtiles`. Konkreten ukaz je v tem primeru

```
py3dtiles convert "pot\do\datoteke\GKOT.laz" --out "mapa\za\output" --srs_in 3794 --srs_out 4978
```

Dodatna parametra `srs_in` ter `srs_out` določata vhodni CRS in željeni izhodni CRS zaporedoma. Potrebno je omeniti, da pogosto Cesium ne sprejema standardnega slovenskega koordinatnega sistema EPSG:3794, zato moramo sploh uporabljati te konverzije. V tem primeru, kjer delamo z `.laz` datoteko, lahko, kot smo ravnokar povedali, to konverzijo izvedemo v istem koraku kot konverzijo v 3D Tiles format. Za formate, kot je GeoJSON, bomo podali alternative.

Po izvedbi tega ukaza dobimo v izbrani mapi tri datoteke/mape: mapo `points` in datoteki `preview.pnts`, `tileset.json`. Ko želimo dobljeni 3D Tiles prikazati s knjižnico Cesium, se skličemo na datoteko `tileset.json` s pomočjo ukazov: 
```javascript
const tileset = await Cesium3DTileset.fromUrl("/mapa/za/output/tileset.json");
viewer.scene.primitives.add(tileset);    // Predhodno definiran Viewer objekt
```
To kodo smo že pokazali, ampak smo jo zavoljo razumljivosti spet navedli.

## 5.2 Shapefile

V okviru tega projekta so Shapefile datoteke vsebovale le preproste geometrije, kot so točke, linije in poligone, zato smo take datoteke prevedli v format GeoJSON. Za to pretvorbo lahko uporabimo par pristopov. Mi smo uporabili Python knjižnico `pyshp`, ki jo namestimo tako kot vse ostale Python knjižnice: 
```
pip install pyshp
```

Tu pripomnimo, da obstaja tudi druga pot z uporabo GDAL (geospatial data abstraction library), a je namestitev te knjižnice izjemno zamudna.

V datoteki `shp_to_geojson.py` se nahaja program, s katerim lahko v `cmd.exe` uporabimo ukaz:
```
python shp_to_geojson.py input.shp output.geojson
```
Ta ukaz ustvari datoteko `output.geojson` in vanjo zapiše podatke iz `input.shp`. Ta ukaz sprejema tudi Shapefile v obliki `.zip` mape. Obstajajo pomožni argumenti, kot je recimo `--pretty`, ki poleg konverzije podatkov tudi formatira GeoJSON datoteko in jo s tem naredi bolj berljivo. Za vse pomožne argumente v kodi piše njihova funkcionalnost.


# 6. Konverzija CRS

Kot rečeno, Cesium ne podpira vseh koordinatnih sistemov. Eden izmed takih je npr. EPSG:3794, ki je pogosto v rabi pri slovenskih podatkih. V prejšnjem razdelku smo že povedali, da lahko za `.laz` datoteke CRS pretvorimo v istem koraku kot pretvorba v 3D Tiles. V tem razdelku povemo, kako lahko splošneje naredimo pretvorbo med koordinatnimi sistemi v JavaScriptu. To še posebej pride prav, ko imamo opravka z GeoJSON datotekami, saj Cesium za take datoteke, v katerih CRS ni eksplicitno napisan, privzema standardni WGS84 koordinatni sistem. 

Osrednja knjižnica je `proj4`, ki nam pomaga "naučiti" Cesium, kako prehajati med CRS-ji, ki jih ne pozna. Primer kode:
```javascript
proj4.defs(
    "EPSG:3794",
    "+proj=tmerc +lat_0=0 +lon_0=15 +k=0.9999 +x_0=500000 +y_0=-5000000 +ellps=GRS80 +units=m +no_defs"
);

GeoJsonDataSource.crsNames["urn:ogc:def:crs:EPSG::3794"] = (coordinates) =>
    Cartesian3.fromDegrees(...proj4("EPSG:3794", "WGS84", coordinates));
```

Prvi ukaz zgoraj definira CRS `EPSG:3794`, drugi ukaz pa knjižnici Cesium pove, kako naj izvaja konverzije med tem CRS in standardnim WGS84, ko se gre za GeoJSON datoteke. 

Pripomnimo, da smo tu uporabili dva različna zapisa CRS. Pri `proj4.defs` smo zapisali "EPSG:3794," medtem ko smo v `GeoJsonDataSource.crsNames` definirali "urn:ogc:def:crs:EPSG::3794." To je zgolj posledica površnosti. Bolje bi bilo, če bi bili dosledni in si izbrali le en zapis, ki bi se pojavljal povsod.


# 7. Delovanje kode

V tem poglavju grobo razložimo delovanje raznih delov kode projekta, ki mogoče potrebujejo več razlage.

## 7.1 Datoteka `drape_geojson_on_pointcloud.py`

Ta program nam omogoča, da v `cmd.exe` s preprostim ukazom pretvorimo GeoJSON datoteko z 2D podatki v novo GeoJSON datoteko s 3D podatki, ki se prilegajo na vstavljen oblak točk v formatu `.laz`. Ukaz je naslednji: 
```
python drape_geojson_on_pointcloud.py --laz pointcloud.laz --geojson input.geojson --out output.geojson
```
Koda omogoča tudi razne dodatne parametre, ki so razloženi v kodi.

Zdaj z besedami opišemo delovanje procesa "polaganja" GeoJSON podatkov na oblak točk. Osnovna ideja tega programa je, da za vsako točko v GeoJSON datoteki `input.geojson` poišče prvih $k$ najbližjih sosedov na oblaku točk (ni zagotovljeno, da bo točka v GeoJSON datoteki sovpadala z neko točko na oblaku točk). Nato izračuna predvideno višino te točke na podlagi višin njenih sosedov tako, da uporabi obteženo povprečje višin sosedov. To lahko povemo tudi z matematično formulo.
Višina točke \(v\) se izračuna kot:

```math
h(v) =
\frac{
    \sum_{i=1}^{k} \frac{1}{d(v,w_i)^p} h(w_i)
}{
    \sum_{i=1}^{k} \frac{1}{d(v,w_i)^p}
}
```
kjer so $w_{i}$ sosedi točke $v$.

## 7.2 Datoteka `syncMaps.js`

Namen te datoteke je uskladiti premike OpenLayers zemljevida in CesiumJS zemljevida. Ko uporabnik prižge 3D zemljevid, želimo, da se oba zemljevida premikata sosledno, Ko uporabnik ugasne 3D zemljevid pa zahtevamo, da se tudi preneha usklajevanje zemljevidov, da ne bi v ozadju brez potrebe trošili računalnikove kapacitete. Glavnina kode je vsebovana v eni sami funkciji `setupMapSync.js`, katere končni cilj je nastaviti `EventListener`-je, ki ob premikih 2D ali 3D zemljevida primerno premaknejo/nagnejo drugi zemljevid. Funkcija vrne dve drugi funkciji `enable()` in `disable()`, ki prižgeta/ugasneta sistem usklajevanja zemljevidov. Zelo osnoven primer tega, kako ti dve funkciji kličemo:
```javascript
const sync = setupMapSync(map2d, viewer);
sync.enable();   // Začnemo usklajevanje
sync.disable();  // Ustavimo usklajevanje (odstranimo vse listenerje)
```

Vsak zemljevid ima svoj sistem, ki opisuje katero območje zemljevida trenutno uporabnik vidi. 
1. 2D zemljevid: potrebuje samo središčno točko zemljevida in njivo povečave
2. 3D zemljevid: položaj kamere v prostoru in smer, v katero gleda kamera. Slednje opišemo s podatki `heading`, `pitch`, `roll`
Da prehajamo med tema dvema opisoma, program izračuna točko na tleh na sredini 3D zemljevida. To točko dobimo tako, da potegnemo premico v smeri pogleda kamere in ugotovimo, kje ta premica trči v površino Zemlje. Potem se pogled na 2D zemljevidu nastavi tako, da je ta točka na sredini 2D zemljevida. Povečava na 2D zemljevidu je odvisna od tega, kako daleč je 3D kamera od najdene točke.

### 7.2.1 Uskladitev 3D zemljevida glede na premike 2D zemljevida

Ta sistem se sproži, ko se središče ali povečava 2D zemljevida spremenita. Opisan je v funkciji `syncCesiumFrom2D`.

**Togi premik**: Ko samo premaknemo zemljevid z levim klikom, program primerja dva podatka:
1. Točko, v katero trenutno gleda 3D zemljevid
2. Trenutno središče 2D zemljevida
Razlika med tema dvema podatkoma se pretvori v dve števili: zamik v vzhodni smeri in zamik v severni smeri. Kamero na 3D zemljevidu potem zamaknemo za ti dve vrednosti. Nagnjenosti 3D kamere ne spreminjamo.

**Povečanje**: Ločimo dva primera za boljše delovanje programa:
1. Ko je pogled 3D kamere "skoraj vertikalen" (to pomeni, da je nagnjenost manjša od 8°), se pretvarjamo, da je pogled kar vertikalen in izračunamo, kako daleč od Zemlje mora biti kamera, da se njen pogled ujema s trenutno resolucijo 2D zemljevida. Ta račun se izvede vsakič znova, zato se računska napaka ne akumulira s časom.
2. Ko je pogled 3D kamere nagnjen za bolj kot 8°, sistem reagira samo na spremembe v 2D povečavi. To pomeni, da, če smo 2D zemljevid povečali za 20%, se bo tudi 3D kamera pomagnila 20% bližje.

### 7.2.2 Uskladitev 2D zemljevida glede na premike 3D zemljevida

Ta sistem se sproži vsakič, ko se 3D kamera premakne (event `changed`) in po koncu premikanja kamere (event `moveEnd`). Spet obravnavamo dva primera glede na nagnjenost zemljevida:
1. Če je nagnjenost manjša od 8°, potem nastavimo središče 2D zemljevida na točko, ki je na sredini 3D pogleda. Povečavo direktno izračunamo na podlagi višine 3D kamere (ravno obraten izračun kot v prejšnjem delu).
2. Če je nagnjenost večja od 8°, poskušamo na 2D zemljevidu prikazati trapez, ki ga vidimo na 3D zemljevidu. To dosežemo tako, da ugotovimo, katere točke na Zemlji sovpadajo s štirimi vogali pogleda na 3D zemljevidu. 
V obeh primerih funkcija nariše oranžen trapez na 2D zemljevidu, ki predstavlja trenuten pogled 3D zemljevida.

### 7.2.3 Preprečevanje neskončne zanke

Sprememba enega zemljevida sproži spremembo drugega, kar bi lahko nato znova sprožilo spremembo prvega zemljevida itn. Program prepreči tako situacijo z dvema indikatorjema `isSyncingFromCesium` in `isSyncingFromOl`. 

Kadarkoli se ena smer sinhronizacije sproži, nastavi primerni indikator na `true`. Ko se potem sproži druga smer sinhronizacije, jo preprost `if` stavek takoj ustavi, preden bi se lahko začela neskončna zanka. Nato se indikator nastavi nazaj na `false`. Tako smo zagotovili, da indikator ostane živ natanko tako dolgo, da ujame odmev lastne spremembe.

Za vsak slučaj se v vsakem primeru indikator nastavi nazaj na `false` po 250ms, da ne bi potem zadušil naslednjega (morda povsem upravičenega) poskusa uskladitve.

### 7.2.4 Dodatna pripomba
Ko računamo presečišče premice, vzdolž katere 3D kamera gleda, in Zemlje, uporabimo objekt `Ellipsoid`. Ker je iskanje preseka premice z oblakom točk nezanesljivo (včasih premica zgreši oblak točk), ima Cesium vgrajene objekte, kot je `Ellipsoid`, s katerimi lahko nato računamo presečišča ipd. Standardni WGS84 elipsoid zelo dobro aproksimira obliko planeta na nadmorski višini 0, kar pomeni da za oblake točk, ki predstavljajo območja, ki niso tik ob morju, funkcije računanja presečišč vračajo napačne rezultate. Temu primerno smo pri temu projektu elipsoid povečali tako, da se njegova površina nahaja ravno pri nadmorski višini Ljubljane. S tem zagotovimo, da sta presek premice s tem elipsoidom in (idealni) presek iste premice z oblakom točk skoraj enaka.

## 7.3 Datoteki `pointMode.js` in `lineMode.js`

Obe datoteki služita zelo podobni vlogi risanja/označevanja točk/črt na 3D zemljevidu, zato ju obravnavamo skupaj. Sledeči opis predvsem govori o `pointMode.js`, ampak vse razlage se povsem enako dobro obnesejo tudi za `lineMode.js`.

Ko prižgemo Point mode, miški sledi t.i. "hover entity". To je navidezna točka, ki je postavljena na točko v oblaku, ki je najbližje trenutnemu položaju miške. Levi klik miške povzroči, da se trenuten položaj "hover entity"-ja shrani v seznam, na njegov položaj pa se postavi obarvana točka z izpisanimi koordinatami. Seznam shranjenih točk je predvsem uporaben za nadaljne implementacije orodij za merjenje razdalj, ploščin ipd.  

Podobno kot z datoteko `syncMaps.js`, sta ti dve datoteki večinoma le posamezni funkciji, ki vrneta novi funkciji `enable()` in `disable()`, ki ju uporabljamo za prižiganje in ugašanje Point mode-a oz. Line mode-a.

### 7.3.1 Kako poiščemo najbližjo točko na oblaku

Izbor ene same točke na oblaku točk je lahko nadležno, še posebej zato, ker zaradi redkosti točk pri določenih povečavah pogosto miška sploh ni postavljena nad nobeno točko v oblaku. V kodi se nahaja funkcija `pickNearestPointCloudHit`, ki poskusi 9 pikslov: točka pod miško ter dodatnih osem točk, ki so za 5 pikslov stran od miške (smeri gor, dol, levo, desno ter diagonale). Za vsako izmed teh točk izvede naslednje zaporedje korakov: 
1. Preveri, če je karkoli narisano na tem mestu z ukazom `scene.pick`, sicer gre na naslednjo točko
2. Zahteva 3D položaj tega piksla. Če je `none`, gre na naslednjo točko
3. Za vsak slučaj preveri, da je izbran položaj/točka res blizu prvotne točke (na razdalji manj kot 100m), sicer je verjetno zadel točko na čisto drugem delu oblaka in jo zavrže
4. Izračuna razdaljo izbrane točke do kamere
Izmed vseh točk, ki uspešno preživijo ta postopek, program izbere najbližjo kameri. S tem zagotovimo, da se bo obarvana točka res videla in ne bo skrita za več drugimi točkami.

### 7.3.2 Hover entity

Tekom izvedbe programa obstaja le en hover entity, ki ga ustvarimo takoj ob zagonu. Njegov položaj se spreminja glede na to, kje je miška na zaslonu. Eden izmed njegovih parametrov je `disableDepthTestDistance`, ki je nastavljen na `Number.POSITIVE_INFINITY`, kar pomeni, da ostane viden, tudi če je kakšna točka iz oblaka tehnično gledano postavljena pred njega. Kasneje, ko uporabnik klikne z miško in se na oblaku pojavi obarvana točka, ima le-ta ta parameter nastavljen na 0, kar pomeni, da se lahko skrije v oblaku točk.