import { addIncompleteRoom } from './builder-data.js';
export function appendUploadViewpoints(original, names) {
  const tour=structuredClone(original);
  tour.builder??={version:1,unplaced:[],missing:[]};
  const ids=[];
  for(const name of names){
    if(typeof name!=='string'||!name.trim()||name.trim().length>80)throw Error('Name every new viewpoint (at most 80 characters).');
    const id=addIncompleteRoom(tour,name.trim());
    tour.builder.missing=tour.builder.missing.filter(r=>r!==id);ids.push(id);
  }
  return {tour,ids};
}
export function assertAdditiveUpload(oldTour,oldPhotos,tour,photos){
  const added=tour.rooms.slice(oldTour.rooms.length);
  if(!added.length||added.length>12)throw Error('Choose at least one new viewpoint.');
  const expected=appendUploadViewpoints(oldTour,added.map(r=>r.name));
  if(JSON.stringify(expected.tour)!==JSON.stringify(tour)||Object.entries(oldPhotos).some(([id,photo])=>photos[id]!==photo))throw Error('Quick uploads can only add unplaced viewpoints. Use the full editor for other changes.');
  return added.length;
}
