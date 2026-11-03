/* Interface de jogo, favoritos e sequências. Usa a ponte existente e não inicia movimentos ao carregar. */
(() => {
  'use strict';
  const init=()=>{
    if(!K9Hub.socket){window.addEventListener('DOMContentLoaded',init,{once:true});return;}
    const hub=K9Hub, core=K9ExperienceCore, $=id=>document.getElementById(id);
    const t=(s,...args)=>window.K9I18n ? K9I18n.t(s,...args) : s;
    const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
    const save=(key,v)=>{try{localStorage.setItem(key,JSON.stringify(v));}catch{hub.toast(t('Não foi possível salvar neste navegador.'),'warn');}};
    const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text)el.textContent=t(text);if(cls)el.className=cls;return el;};
    const button=(label,fn)=>{const b=node('button',label,'btn');b.type='button';b.addEventListener('click',fn);return b;};
    let lastTelemetry=0,lastData={},ownSend=false;
    const originalSend=hub.sendCmd.bind(hub), originalStop=hub.stopAll.bind(hub);
    const ready=()=>!!(hub.socket?.connected && hub.link.robot && Date.now()-lastTelemetry<4000);
    const stop=()=>{originalStop();if(hub.socket.connected)hub.socket.emit('k9:cmd',{cmd:'sound_stop'});};
    const player=new core.Player({
      ready,stop,send:(cmd,label)=>{ownSend=true;try{originalSend(cmd,label);}finally{ownSend=false;}},
      onState:s=>{ $('sequenceStatus').textContent=s.active?t('Passo {0} de {1}',s.index+1,s.total):t('Sequência parada'); }
    });
    const manual=()=>{player.cancel(true);window.K9NPC?.stop();};
    hub.sendCmd=function(cmd,label,origin) {
      if(!ownSend && origin!=='npc' && !/^sound_(volume_|mute|unmute)/.test(cmd)) manual();
      return originalSend(cmd,label);
    };
    hub.stopAll=function(){manual();return originalStop();};
    const originalSource=hub.setSource.bind(hub);
    hub.setSource=function(source,f,turn) {
      if(source!=='npc' && (Math.abs(f)>.01 || Math.abs(turn)>.01)) manual();
      return originalSource(source,f,turn);
    };
    $('activityStop').addEventListener('click',()=>hub.stopAll());
    document.addEventListener('visibilitychange',()=>{if(document.hidden){manual();stop();}});
    window.addEventListener('pagehide',()=>{manual();stop();});
    document.addEventListener('k9:npc',()=>player.cancel(true));
    document.addEventListener('k9:npc-state',e=>$('idlePersonality').setAttribute('aria-pressed',String(!!e.detail)));
    $('idlePersonality').addEventListener('click',()=>{
      if(window.K9NPC?.isActive()){window.K9NPC.stop();stop();}
      else if(ready()){player.cancel(true);window.K9NPC?.startIdle();}
      else hub.toast(t('Robô offline.'),'warn');
    });

    // View modes only affect presentation, never command the robot.
    function view(mode) {
      mode=mode==='personality'?'personality':'control';
      document.body.dataset.experience=mode;
      document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===mode)));
      if(mode==='personality') $('tabEmocoes').click();
      save('k9.experience.view',mode);
    }
    document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.view)));
    view(read('k9.experience.view','control'));
    $('gameFullscreen').addEventListener('click',async()=>{
      try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}
      catch{hub.toast(t('Tela cheia indisponível neste navegador.'),'warn');}
    });

    function dialog(id,title) {
      const d=node('dialog',null,'experience-dialog');d.id=id;
      const head=node('div',null,'settings-heading'),h=node('h2',title);h.id=id+'Title';
      d.setAttribute('aria-labelledby',h.id);
      head.append(h,button('Fechar',()=>d.close()));d.append(head);document.body.append(d);return d;
    }
    // Six favourites, local to this browser; commands are validated against the catalogue.
    const validCmds=Object.keys(core.catalogue).filter(c=>c!=='wait');
    let favorites=read('k9.experience.favorites',['emotion_curious','emotion_celebrate','emotion_greet','sleep','wake','scratch']);
    if(!Array.isArray(favorites))favorites=[];
    favorites=[...new Set(favorites)].filter(c=>validCmds.includes(c)).slice(0,6);
    const favoritesDialog=dialog('favoritesDialog','Escolher favoritos');
    const choices=node('div');choices.id='favoriteChoices';
    const favoriteHint=node('p','Escolha até seis comandos.');
    favoritesDialog.append(favoriteHint,choices);
    function renderFavorites() {
      $('favoriteButtons').replaceChildren(...favorites.map(cmd=>button(core.catalogue[cmd][0],()=>hub.sendCmd(cmd,core.catalogue[cmd][0]))));
    }
    validCmds.forEach(cmd=>{
      const label=node('label',null,'favorite-choice'),cb=document.createElement('input');cb.type='checkbox';cb.checked=favorites.includes(cmd);
      cb.addEventListener('change',()=>{
        if(cb.checked && favorites.length>=6){cb.checked=false;hub.toast(t('Escolha até seis comandos.'),'warn');return;}
        favorites=cb.checked?[...favorites,cmd]:favorites.filter(c=>c!==cmd);
        save('k9.experience.favorites',favorites);renderFavorites();
      });
      label.append(cb,node('span',core.catalogue[cmd][0]));choices.append(label);
    });
    $('favoritesEdit').addEventListener('click',()=>favoritesDialog.showModal());renderFavorites();

    // Named sequences: explicitly played, bounded duration, cancellation on manual control/offline.
    const seq=dialog('sequenceDialog','Editor de sequências');
    const form=node('div',null,'form-row');
    const command=document.createElement('select');command.setAttribute('aria-label',t('Comando'));
    for(const [cmd,[label]] of Object.entries(core.catalogue)) {const opt=node('option',label);opt.value=cmd;command.append(opt);}
    const seconds=document.createElement('input');seconds.type='number';seconds.min='.5';seconds.max='30';seconds.step='.5';seconds.value='1.5';seconds.setAttribute('aria-label',t('Duração em segundos'));
    command.addEventListener('change',()=>seconds.value=String(core.catalogue[command.value][1]/1000));
    const list=node('ol');list.id='sequenceSteps';
    const status=node('p','Sequência parada');status.id='sequenceStatus';status.setAttribute('role','status');
    let steps=[],saved=read('k9.experience.sequences',{});
    if(!saved || typeof saved!=='object' || Array.isArray(saved)) saved={};
    saved=Object.fromEntries(Object.entries(saved).slice(0,20).filter(([name,items])=>{
      try{core.normalizeSteps(items);return name.length>0&&name.length<=40;}catch{return false;}
    }));
    const name=document.createElement('input');name.maxLength=40;name.placeholder=t('Nome da sequência');name.setAttribute('aria-label',t('Nome da sequência'));
    const savedSelect=document.createElement('select');savedSelect.setAttribute('aria-label',t('Sequências salvas'));
    function refreshSaved(){savedSelect.replaceChildren(...Object.keys(saved).map(k=>{const o=node('option');o.textContent=k;o.value=k;return o;}));}
    function renderSteps(){
      list.replaceChildren(...steps.map((step,i)=>{
        const li=node('li',null,'sequence-step');li.append(node('span',t('{0} · {1} s',core.catalogue[step.cmd][0],step.ms/1000)));
        const up=button('↑',()=>{[steps[i-1],steps[i]]=[steps[i],steps[i-1]];renderSteps();});up.disabled=i===0;up.setAttribute('aria-label',t('Mover para cima'));
        const down=button('↓',()=>{[steps[i+1],steps[i]]=[steps[i],steps[i+1]];renderSteps();});down.disabled=i===steps.length-1;down.setAttribute('aria-label',t('Mover para baixo'));
        const duration=document.createElement('input');duration.type='number';duration.min='.5';duration.max='30';duration.step='.5';duration.value=step.ms/1000;duration.style.width='90px';duration.setAttribute('aria-label',t('Duração em segundos'));
        duration.addEventListener('change',()=>{try{const next=steps.map((s,j)=>j===i?{...s,ms:Number(duration.value)*1000}:s);steps=core.normalizeSteps(next);}catch(e){hub.toast(t(e.message),'warn');}renderSteps();});
        li.append(duration,up,down,button('Remover',()=>{steps.splice(i,1);renderSteps();}));return li;
      }));
    }
    form.append(command,seconds,button('Adicionar passo',()=>{
      try{steps=core.normalizeSteps([...steps,{cmd:command.value,ms:Number(seconds.value)*1000}]);renderSteps();}
      catch(e){hub.toast(t(e.message),'warn');}
    }));
    const saveRow=node('div',null,'form-row');saveRow.append(name,button('Salvar sequência',()=>{
      const key=name.value.trim();if(!key){hub.toast(t('Dê um nome à sequência.'),'warn');return;}
      try{const clean=core.normalizeSteps(steps);if(!Object.hasOwn(saved,key)&&Object.keys(saved).length>=20)throw Error('Limite de 20 sequências.');
        saved=Object.fromEntries([...Object.entries(saved).filter(([k])=>k!==key),[key,clean]]);
        save('k9.experience.sequences',saved);refreshSaved();savedSelect.value=key;
      }catch(e){hub.toast(t(e.message),'warn');}
    }));
    const loadRow=node('div',null,'form-row');loadRow.append(savedSelect,button('Carregar',()=>{
      if(Object.hasOwn(saved,savedSelect.value)){name.value=savedSelect.value;steps=core.normalizeSteps(saved[savedSelect.value]);renderSteps();}
    }),button('Excluir',()=>{const key=savedSelect.value;if(Object.hasOwn(saved,key)){delete saved[key];save('k9.experience.sequences',saved);refreshSaved();}}));
    const playRow=node('div',null,'form-row');playRow.append(button('Reproduzir',()=>{
      try{if(!ready())throw Error('Robô offline.');window.K9NPC?.stop();stop();player.start(steps);}
      catch(e){hub.toast(t(e.message),'warn');}
    }),button('Interromper',()=>{player.cancel(true);stop();}));
    seq.append(node('p','Até 16 passos. Ajuste a duração de cada movimento ou pausa.'),form,list,saveRow,loadRow,playRow,status);
    seq.addEventListener('close',()=>player.cancel(true));
    $('sequenceOpen').addEventListener('click',()=>seq.showModal());refreshSaved();

    // Game-style settings sections: same nodes and existing handlers, grouped into tabs.
    const body=document.querySelector('#advDetails > .adv-body');
    const sections=[...body.children];
    sections.forEach(section=>{
      section.dataset.settings='maintenance';
      if(section.matches('.keyboard-menu')) section.dataset.settings='controls';
      else if(section.querySelector('#h-conn,#h-wifi'))section.dataset.settings='connection';
    });
    const audio=node('section',null,'adv-sec adv-wide');audio.dataset.settings='audio';
    const volume=document.createElement('input');volume.type='range';volume.min='0';volume.max='100';volume.step='5';volume.setAttribute('aria-label',t('Volume'));
    volume.addEventListener('change',()=>hub.sendCmd('sound_volume_'+volume.value,'Volume'));
    const mute=button('Mudo',()=>$('soundMute').click());mute.setAttribute('aria-pressed','false');
    audio.append(node('h3','Áudio'),volume,mute);
    const camera=node('section',null,'adv-sec adv-wide');camera.dataset.settings='camera';
    camera.append(node('h3','Câmera'),button('Lanterna',()=>hub.toggleFlash()),button('Strobo',()=>$('strobeBtn').click()));
    body.append(audio,camera);
    const tabbar=node('div',null,'settings-tabs');tabbar.setAttribute('role','tablist');tabbar.setAttribute('aria-label',t('Categorias de configurações'));
    const groups=[['controls','Controles'],['audio','Áudio'],['camera','Câmera'],['maintenance','Manutenção'],['connection','Conexão']];
    const panels=[];
    groups.forEach(([id,label])=>{
      const panel=node('div',null,'adv-body');panel.id='settingsPanel-'+id;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','settingsTab-'+id);panel.style.gridColumn='1/-1';
      [...body.children].filter(n=>n.dataset.settings===id).forEach(n=>panel.append(n));body.append(panel);panels.push(panel);
      const b=button(label,()=>selectSettings(id));b.id='settingsTab-'+id;b.dataset.category=id;b.setAttribute('role','tab');b.setAttribute('aria-controls',panel.id);tabbar.append(b);
    });
    function selectSettings(id) {panels.forEach(p=>p.hidden=p.id!=='settingsPanel-'+id);[...tabbar.children].forEach(b=>{const on=b.dataset.category===id;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;});}
    tabbar.addEventListener('keydown',e=>{
      const buttons=[...tabbar.children],i=buttons.indexOf(e.target);if(i<0)return;
      const at={ArrowRight:(i+1)%buttons.length,ArrowLeft:(i+buttons.length-1)%buttons.length,Home:0,End:buttons.length-1}[e.key];
      if(at!==undefined){e.preventDefault();selectSettings(buttons[at].dataset.category);buttons[at].focus();}
    });
    body.prepend(tabbar);
    const voice=document.querySelector('#settingsContent > .nome-config');
    if(voice) $('settingsPanel-controls').prepend(voice);
    selectSettings('controls');
    function renderActivity() {
      const online=ready();
      $('activityLabel').textContent=t(!online?'Aguardando robô':(Math.abs(lastData.fwd||0)>.1||Math.abs(lastData.turn||0)>.1)?'Andando':core.activityNames[lastData.activity]||'Pronto');
      if(!online && (player.active || window.K9NPC?.isActive())){manual();stop();}
    }
    hub.socket.on('k9:telemetry',d=>{
      lastTelemetry=Date.now();lastData=d;
      if(Number.isInteger(d.soundVolume))volume.value=d.soundVolume;
      volume.disabled=!d.online;mute.disabled=!d.online;mute.setAttribute('aria-pressed',String(!!d.soundMuted||d.soundVolume===0));
      renderActivity();
    });
    hub.socket.on('disconnect',()=>{lastTelemetry=0;manual();renderActivity();});
    hub.socket.on('k9:status',d=>{if(d?.online===false){lastTelemetry=0;manual();renderActivity();}});
    setInterval(renderActivity,1000);
    document.addEventListener('k9:lang',()=>{renderFavorites();renderSteps();renderActivity();});
  };
  if(document.readyState==='loading')window.addEventListener('DOMContentLoaded',init);else init();
})();
