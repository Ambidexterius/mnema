/** Circular fillets in SVG coordinates; callers compensate for display scale. */
export function roundedPolygon(points:readonly (readonly [number,number])[],radius:number):string{
 const corners=points.map((point,index)=>{
  const prev=points[(index+points.length-1)%points.length],next=points[(index+1)%points.length];
  const before=Math.hypot(point[0]-prev[0],point[1]-prev[1]),after=Math.hypot(next[0]-point[0],next[1]-point[1]);
  const incoming=[(point[0]-prev[0])/before,(point[1]-prev[1])/before],outgoing=[(next[0]-point[0])/after,(next[1]-point[1])/after];
  const turn=Math.atan2(incoming[0]*outgoing[1]-incoming[1]*outgoing[0],incoming[0]*outgoing[0]+incoming[1]*outgoing[1]);
  const tangent=Math.tan(Math.abs(turn)/2),distance=Math.min(radius*tangent,before/2,after/2);
  return {start:[point[0]-incoming[0]*distance,point[1]-incoming[1]*distance],end:[point[0]+outgoing[0]*distance,point[1]+outgoing[1]*distance],radius:distance/tangent,sweep:turn>0?1:0};
 });
 const number=(n:number)=>Number(n.toFixed(5));
 return corners.map((corner,index)=>`${index?'L':'M'}${corner.start.map(number).join(' ')}A${number(corner.radius)} ${number(corner.radius)} 0 0 ${corner.sweep} ${corner.end.map(number).join(' ')}`).join('')+'Z';
}
export function folderPaths(displayRadius:number,scale:number){
 const radius=displayRadius/scale;
 return {radius,back:roundedPolygon([[0,34],[146,34],[198,0],[340,0],[340,272],[0,272]],radius),front:roundedPolygon([[0,74],[118,74],[172,106],[340,106],[340,272],[0,272]],radius)};
}
