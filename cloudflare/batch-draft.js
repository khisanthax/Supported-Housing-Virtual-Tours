import { MAX_ROOMS } from './tour-package.js';
import { reviewBatch } from './batch-review.js';

export async function importBatch(files, draft, fresh, verify, commit) {
  const empty = { tour: { id: 'apartment', title: 'Untitled apartment', rooms: [] }, images: new Map() };
  const original = fresh ? empty : draft;
  await reviewBatch(files, original, verify, async (chosen, progress) => {
    const tour = structuredClone(original.tour);
    const images = new Map(original.images);
    const replaced = new Set();
    let first;
    for (const row of chosen) {
      let room = tour.rooms.find(item => item.id === row.assignment);
      if (room) {
        if (replaced.has(room.id)) throw new Error('Choose just one replacement per viewpoint.');
        replaced.add(room.id);
        room.name = row.name;
      } else {
        if (tour.rooms.length >= MAX_ROOMS) throw new Error('This tour can contain at most 12 viewpoints.');
        let number = 1;
        while (images.has('room-' + number)) number++;
        const id = 'room-' + number;
        room = { id, name: row.name, image: 'images/' + id + '.jpg',
          initialView: { yaw: 0, pitch: 0, fov: 1.45 }, links: [] };
        tour.rooms.push(room);
      }
      first ??= room.id;
      images.set(room.id, row.file);
    }
    tour.startRoom ??= first;
    await commit({ tour, images }, first, 'Batch saved. Place doorway arrows to connect the viewpoints.', false, progress);
  });
}
