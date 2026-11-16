import React from 'react';
import BrandMark,{BetaMark} from './BrandMark.tsx';
import './auth.css';

export default function AuthHeading({title,description}:{title:string;description?:string}){
 return <header className="auth-form-heading"><div className="auth-symbol" role="img" aria-label="Мнемоника, бета-версия"><BrandMark/><BetaMark/></div><h1 className="auth-title">{title}</h1>{description?<p className="auth-description">{description}</p>:null}</header>;
}
