/* Общий компонент карты участков. Подключается после Яндекс API 2.1.
   Источник данных задаётся атрибутом data-source у контейнера. */
(() => {
  'use strict';
  let apiPromise;
  function loadApi() {
    if (window.ymaps) return Promise.resolve(window.ymaps);
    if (!apiPromise) apiPromise = new Promise((resolve, reject) => {
      const key = String(window.LAND_MAP_API_KEY || '').trim();
      if (!key || key === 'ВСТАВЬ_СЮДА_КЛЮЧ') {
        reject(new Error('Укажите API-ключ в map-api-config.js')); return;
      }
      const script = document.createElement('script');
      script.src = 'https://api-maps.yandex.ru/2.1/?apikey=' + encodeURIComponent(key) + '&lang=ru_RU';
      script.onload = () => window.ymaps ? resolve(window.ymaps) : reject(new Error('API 2.1 не инициализирован'));
      script.onerror = () => reject(new Error('Не загрузился JavaScript API 2.1'));
      document.head.appendChild(script);
    });
    return apiPromise;
  }
  const markup = `<div class="lm-toolbar"><div class="lm-buttons" role="group" aria-label="Тип карты">
    <button type="button" class="lm-button" data-type="yandex#map" disabled>Схема</button>
    <button type="button" class="lm-button" data-type="yandex#satellite" disabled>Спутник</button>
    <button type="button" class="lm-button" data-type="yandex#hybrid" disabled>Гибрид</button></div>
    <div class="lm-buttons"><button type="button" class="lm-button lm-reset" disabled>Все участки</button><button type="button" class="lm-button lm-full" hidden>На весь экран</button></div></div>
    <p class="lm-status" role="status">Загрузка карты…</p><div class="lm-legend"><span><i class="lm-swatch" style="background:#3f6f52"></i>Свободен</span><span><i class="lm-swatch" style="background:#d98b3a"></i>Забронирован</span><span><i class="lm-swatch" style="background:#a6a6a6"></i>Продан</span></div>
    <div class="lm-stage"><div class="lm-map" aria-label="Интерактивная карта участков"></div><section class="lm-card" hidden aria-label="Информация об участке"><button class="lm-button lm-close" type="button" aria-label="Закрыть карточку">×</button><h3></h3><span class="lm-pill"></span><dl></dl></section></div>`;
  function fields(properties) {
    const result = {};
    for (const line of (properties.description || '').split(/<br\s*\/?\s*>/i)) {
      const text = new DOMParser().parseFromString(line, 'text/html').body.textContent.trim();
      const colon = text.indexOf(':');
      if (colon >= 0) result[text.slice(0,colon).trim()] = text.slice(colon+1).trim();
    }
    return result;
  }
  function plotCenter(parts) {
    // GeoJSON: [долгота, широта]; API 2.1: [широта, долгота].
    // Для MultiPolygon выбираем часть с наибольшим ограничивающим прямоугольником.
    let best = null;
    for (const part of parts) {
      const ring = part[0];
      if (!Array.isArray(ring) || !ring.length) throw new Error('Пустой контур участка');
      let minLon=Infinity, minLat=Infinity, maxLon=-Infinity, maxLat=-Infinity;
      for (const [lon,lat] of ring) {
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error('Некорректные координаты участка');
        minLon=Math.min(minLon,lon); maxLon=Math.max(maxLon,lon);
        minLat=Math.min(minLat,lat); maxLat=Math.max(maxLat,lat);
      }
      const size=(maxLon-minLon)*(maxLat-minLat);
      if (!best || size>best.size) best={size,center:[(minLat+maxLat)/2,(minLon+maxLon)/2]};
    }
    if (!best) throw new Error('Отсутствует геометрия участка');
    return best.center;
  }
  const normalizeStatus = value => value === 'reserved' ? 'booked' : value;
  const statusNames = {free:'Свободен', booked:'Забронирован', sold:'Продан'};
  async function mount(root) {
    root.innerHTML = markup;
    const q = selector => root.querySelector(selector);
    const status = q('.lm-status'), card = q('.lm-card'), mapNode = q('.lm-map');
    const buttons = [...root.querySelectorAll('[data-type]')];
    try {
      const response = await fetch(root.dataset.source,{cache:'no-store'});
      if (!response.ok) throw new Error('GeoJSON: HTTP '+response.status);
      const data = await response.json();
      if (!Array.isArray(data.features)) throw new Error('Некорректный GeoJSON');
      const plots = data.features;
      if (!plots.length) {
        status.textContent='Участки пока не добавлены.';
        q('.lm-toolbar').hidden=true; q('.lm-legend').hidden=true;
        if (root.dataset.emptyMap) {
          const frame=document.createElement('iframe');
          frame.src=root.dataset.emptyMap;
          frame.title='Обзор территории'; frame.loading='lazy';
          frame.style.cssText='width:100%;height:100%;border:0;display:block';
          mapNode.append(frame);
        } else mapNode.hidden=true;
        return;
      }
      const api = await loadApi();
      await new Promise((resolve,reject)=>api.ready(resolve,reject));
      const map = new api.Map(mapNode,{center:[56,93],zoom:12,type:root.dataset.mapType || 'yandex#hybrid',controls:['zoomControl']});
      const polygonsCollection = new api.GeoObjectCollection();
      const labelsCollection = new api.GeoObjectCollection();
      map.geoObjects.add(polygonsCollection);map.geoObjects.add(labelsCollection);
      const NumberLayout = api.templateLayoutFactory.createClass('<div class="lm-number">{{ properties.plotNumber }}</div>');
      let selected = [];
      const plotIndex = new Map();
      function clear(notify = true) {
        for(const [polygon,style] of selected) polygon.options.set(style);
        selected=[];card.hidden=true;
        if(notify) root.dispatchEvent(new CustomEvent('land-map-selection',{bubbles:true,detail:{cadastralNumber:null,source:root.dataset.listSource}}));
      }
      function select(polygons,style,p,details,number) {
        clear(false);selected=polygons.map(polygon=>[polygon,style]);
        for(const polygon of polygons) polygon.options.set({strokeColor:'#f59e0b',strokeWidth:4,strokeOpacity:1});
        q('.lm-card h3').textContent='Участок №'+(number || '—');
        const pill=q('.lm-pill'), state=normalizeStatus(p.status);
        pill.textContent=statusNames[state] || p.statusText || 'Статус не указан';pill.dataset.status=state || '';
        const dl=q('.lm-card dl');dl.replaceChildren();
        for(const [key,value] of Object.entries(details)) {
          if(key==='Статус'||key==='Номер участка')continue;
          const dt=document.createElement('dt');dt.textContent=key;
          const dd=document.createElement('dd');dd.textContent=value;
          if(key==='Стоимость')dd.className='lm-price';dl.append(dt,dd);
        }
        card.hidden=false;
        root.dispatchEvent(new CustomEvent('land-map-selection',{bubbles:true,detail:{cadastralNumber:String(details['Кадастровый номер'] || '').trim(),source:root.dataset.listSource}}));
      }
      function centerOn(center) {
        // При выборе не меняем текущий масштаб, даже если участок маленький.
        if (!center) return;
        try {
          Promise.resolve(map.setCenter(center,map.getZoom(),{duration:250,checkZoomRange:false}))
            .catch(error=>console.warn('Не удалось центрировать карту',error));
        } catch(error){console.warn('Не удалось центрировать карту',error);}
      }
      for(const plot of plots){
        const p=plot.properties || {},g=plot.geometry;
        const parts=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
        if(!parts.length)throw new Error('Неподдерживаемая геометрия: '+g.type);
        const details=fields(p),number=(p.hintContent || '').match(/Участок\s*№?\s*(\d+)/i)?.[1] || details['Номер участка'];
        const style={fillColor:p.fill,fillOpacity:Number(p['fill-opacity']),strokeColor:p.stroke,strokeOpacity:Number(p['stroke-opacity'] ?? 1),strokeWidth:Number(p['stroke-width']),hasBalloon:false,hasHint:false};
        const polygons=parts.map(part=>new api.Polygon(part.map(ring=>ring.map(([lon,lat])=>[lat,lon])),{},style));
        const cad=String(details['Кадастровый номер'] || '').trim();
        // Центр считаем по исходным координатам GeoJSON, а не через
        // geometry.getBounds(): API 2.1 требует добавления объекта на карту.
        const center=plotCenter(parts);
        if(cad)plotIndex.set(cad,{polygons,style,p,details,number,center});
        const choose=event=>{event.stopPropagation();select(polygons,style,p,details,number);centerOn(center);};
        for(const polygon of polygons){polygon.events.add('click',choose);polygonsCollection.add(polygon);}
        if(number){
          const label=new api.Placemark(center,{plotNumber:number},{iconLayout:NumberLayout,iconShape:{type:'Rectangle',coordinates:[[-10,-8],[10,8]]},hasBalloon:false,hasHint:false,zIndex:1000,interactiveZIndex:false});
          label.events.add('click',choose);labelsCollection.add(label);
        }
      }
      q('.lm-close').addEventListener('click',()=>clear());map.events.add('click',()=>clear());
      const fit=()=>map.setBounds(polygonsCollection.getBounds(),{checkZoomRange:true,zoomMargin:40});
      await fit();
      root.addEventListener('land-map-focus',event=>{
        const item=plotIndex.get(String(event.detail?.cadastralNumber || '').trim());
        if(!item)return;
        select(item.polygons,item.style,item.p,item.details,item.number);
        centerOn(item.center);
        if(root.getBoundingClientRect().top<0 || root.getBoundingClientRect().top>window.innerHeight*0.75)root.scrollIntoView({block:'start',behavior:'smooth'});
      });
      root.dataset.mapReady='true';
      root.dispatchEvent(new CustomEvent('land-map-ready',{bubbles:true,detail:{source:root.dataset.listSource}}));
      q('.lm-reset').disabled=false;q('.lm-reset').addEventListener('click',()=>{clear();fit();});
      for(const button of buttons){button.disabled=false;button.addEventListener('click',()=>map.setType(button.dataset.type));}
      const sync=()=>buttons.forEach(button=>button.setAttribute('aria-pressed',String(map.getType()===button.dataset.type)));
      map.events.add('typechange',sync);sync();
      const full=q('.lm-full');
      if(document.fullscreenEnabled && root.requestFullscreen){
        full.hidden=false;full.addEventListener('click',async()=>{try{if(document.fullscreenElement===root)await document.exitFullscreen();else await root.requestFullscreen();}catch(error){console.warn(error);}});
        document.addEventListener('fullscreenchange',()=>{full.textContent=document.fullscreenElement===root?'Выйти из полного экрана':'На весь экран';map.container.fitToViewport();});
      }
      if(window.ResizeObserver)new ResizeObserver(()=>map.container.fitToViewport()).observe(mapNode);
      const count=s=>plots.filter(p=>normalizeStatus(p.properties.status)===s).length;
      status.textContent=`Всего: ${plots.length} · Свободно: ${count('free')} · Продано: ${count('sold')} · Забронировано: ${count('booked')}`;
    }catch(error){console.error(error);status.textContent='Не удалось загрузить карту: '+(error.message || error);}
  }
  document.querySelectorAll('[data-land-map]').forEach(mount);
})();
