import type {ReactNode} from 'react';

export default function EmptyState({icon,title,description,action}:{
 icon:ReactNode;
 title:string;
 description:ReactNode;
 action?:ReactNode;
}){
 return <div className="empty-state">
  <span className="empty-state-icon" aria-hidden="true">{icon}</span>
  <h3>{title}</h3>
  <p>{description}</p>
  {action}
 </div>;
}
