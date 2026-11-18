# 第三方组件与数据

| 组件 / 数据 | 用在哪 | 许可 / 条款 |
|---|---|---|
| [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) 5.24.0 | `engine/vendor/`，三维地图渲染 | BSD-3-Clause，全文见 [engine/vendor/LICENSE-maplibre.txt](engine/vendor/LICENSE-maplibre.txt)，build.py 会把它一起复制进生成的网站 |
| [Natural Earth](https://www.naturalearthdata.com/) 1:10m 河流、湖泊、地理区域 | `data/ne/`，底图水系和沙漠 | 公有领域（Public Domain） |
| [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)（Mapzen，AWS Open Data） | 网页和 geo.py 在线读取的高程瓦片 | 需署名其数据源（SRTM、GMTED、ETOPO1 等），见 <https://github.com/tilezen/joerd/blob/master/docs/attribution.md> |
| [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | 网页在线读取的卫星影像 | 受 Esri 使用条款约束，须保留署名（Esri, Maxar, Earthstar Geographics 等）。商用前请自行核对条款，或在 `engine/js/app.js` 的 `SAT` 换成别的影像源 |
| [思源宋体 Source Han Serif](https://github.com/adobe-fonts/source-han-serif) | 仓库不含字体；build.py 从本机字体生成子集，嵌进生成的网站 | SIL Open Font License 1.1 |

生成的网站会在「关于本图」和 `credits` 里列出地形、影像、水系的来源，部署时请保留。

范例中的史料原文、诗文均出自公版古籍（《史记》《汉书》《旧唐书》《新唐书》《全唐诗》、王琦《李太白年谱》等），坐标、路线、考据笔记为本项目整理。
