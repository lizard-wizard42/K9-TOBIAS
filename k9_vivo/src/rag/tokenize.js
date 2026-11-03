'use strict';
/* Tokenização para a busca (português e inglês, pois os documentos do repositório estão em inglês): minúsculas, sem acentos, sem palavras vazias, plural simples. */
const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const VAZIAS = new Set(('a o as os um uma uns umas de do da dos das em no na nos nas por para com sem sob sobre entre ate ao aos e ou que se como mas ' +
  'foi ser sao era tem ter ha isso isto esse essa este esta eles elas ele ela eu tu voce nos me te lhe meu minha seu sua nao sim ja so mais muito ' +
  'tambem quando onde qual quais depois antes ate pelo pela pelos pelas num numa la aqui ai entao pois porque ' +
  'the a an of to in on at by for with from and or is are was were be been it its this that these those as if then than so not no do does did can will what which who when where how why i you he she we they my your our their me us them has have had there here also into over under about up out').split(/\s+/));

function tokens(texto) {
  return norm(texto).split(/[^a-z0-9]+/).filter((w) => w && !VAZIAS.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w));
}
module.exports = { tokens, norm };
