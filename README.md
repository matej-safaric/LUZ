# Opis trenutnega stanja projekta



Seznam datotek:

* main.js
* olMapInit.js
* cesiumMapInit.js
* syncMaps.js
* syncButton.js
* pointMode.js
* lineMode.js
* layerControls.js
* style.css
* index.html
* generateLayersManifest.mjs



##### Kratek opis delovanja:

V command promptu v directoryju `C:\\\\\\\\Users\\\\\\\\matej.safaric\\\\\\\\Documents\\\\\\\\LUZ\\\\\\\\slovenia-map` uporabimo ukaz `npm run dev`, s katerim s pomočjo frontend build orodja Vite poženemo lokalni strežnik.

Nato v brskalniku vpišemo URL: http://localhost:5173/ (morda so številke drugačne).



Pred nami je 2D zemljevid, ki temelji na knjižnici OpenLayers. Program je vnaprej nastavljen tako, da se pokaže eden izmed layerjev, ki so shranjeni v mapi public/data/layers2D. Na desni imamo na voljo več gumbov:

* Show 3D
* Enter Point mode
* Enter Line mode
* Gumbi za izbor layerja (če pritisnemo gumb layerja, ki ga že vidimo, se nič ne zgodi)



Gumba za Point in Line mode ne počneta ničesar dokler 3D zemljevid ni viden. Da prižgemo 3D pogled, pritisnemo gumb Show 3D. Ko je 3D pogled odprt, lahko uporabimo Point ali Line mode:

1. Point mode: s klikanjem po 3D zemljevidu postavljamo obarvane točke, ki se potem prikažejo tudi na 2D zemljevidu
2. Line mode: s klikanjem po 3D zemljevidu postavljamo obarvane točke, ki jih povezuje polyline. Vse narisane objekte lahko nato vidimo tudi na 2D zemljevidu.



Pripomba: Možno je hkrati biti v Point in Line mode-u, kar je napaka. Njen popravek še pride na vrsto.



Če želimo zapreti 3D pogled, pritisnemo Hide 3D.





#### Opis datotek

##### 

###### index.html in style.css

Samoumevno, pač HTML in CSS datoteki, ki sta osnova za spletno stran



###### main.js

Glavna datoteka, ki jo požene index.html, ki se potem povezuje z ostalimi moduli. Vsebuje big-picture strukturo sistema



###### olMapInit.js

Datoteka, ki pripravi 2D zemljevid za prikaz in naloži podatke iz datoteke manifest.json (le-ta se nahaja v isti mapi kot podatki, namreč v layers2D)



###### cesiumMapInit.js

Datoteka, ki pripravi 3D zemljevid, podobno kot olMapInit.js za 2D zemljevid. Glavna strukturna razlika (poleg očitne razlike v knjižnicah OpenLayers in Cesium) je, da je celotna datoteka v obliki funkcije, ki se pokliče, ko

uporabnik klikne na gumb Show 3D.



Ta datoteka vsebuje tudi neuspešno implementacijo s podnaslovom "PREVENT FALLING THROUGH THE POINT CLOUD". Prekomerno povečevanje na 3D zemljevidu namreč omogoča da pademo skozi oblak točk, kar ni zaželeno.



###### syncMaps.js



Vsebuje le funkcijo setupMapSync, ki poveže 2D in 3D zemljevida tako, da premiki enega spremenijo tudi pogled drugega. Funkcija vrne funkciji enable() in disable(), ki sta lahko uporabljeni za vklop ali izklop sinhronizacije

zemljevidov.



###### syncButton.js



Ta datoteka ni več uporabna in se bo kmalu izbrisala. Vsebuje kodo za gumb Sync 3D to 2D, ki je pogled 3D zemljevida nastavila na enak pogled, kot ga ima 2D zemljevid ob trenutku klika. Ta koda je bila predvsem uporabna za usklajevanje zemljevidov takrat, ko le-ti še niso bili povsem usklajeni in je tveganje podivjane kamere še bilo možno.



###### pointMode.js in lineMode.js

Datoteki sta dovolj podobni, da ju obravnavamo skupaj. Razlikujeta se le v kodi, ki določa risanje točk in črt ter v funkciji pickNearestPointCloudHit, ki poišče točko v oblaku, ki jo gleda 3D kamera (oz. točko, ki je najboljši približek). Ta funkcija še doživlja spremembe, da bo lahko izluščila več kot le koordinate ogledane točke. Cilj je, da lahko izlušči poljubne lastnosti gledane točke, npr. barvo, ipd.



###### layerControls.js

Vsebuje le funkcijo, ki naredi toliko gumbov na HTML strani, kot je layerjev v datoteki manifest.json.



###### generateLayersManifest.mjs

Pregleda datoteko layers2D in pripravi datoteko manifest.json, ki jo nato potrebujejo ostale datoteke za prikaz 2D podatkov.







### Opombe

Marsikaj še ne dela popolno. To vključuje:

* Sistem layerjev: trenutno nDMP layer in orthophoto layer delujeta, PAS pa ne (iz nekega razloga)
* Prekomerno povečevanje 3D zemljevida povzroči, da gre kamera pod oblak točk. Idealno bi bilo da se mu lahko kvečjemu asimptotsko približuje
* Performance kode ni najboljši. Gotovo je drugače, če se podatki ne prikazujejo lokalno.
* Gotovo še dosti drugega.

