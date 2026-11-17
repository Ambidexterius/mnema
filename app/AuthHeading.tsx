import React from 'react';
import BrandMark,{BetaMark} from './BrandMark.tsx';
import './auth.css';

export default function AuthHeading({title,description,beta=false}:{title:string;description?:string;beta?:boolean}){
 return <header className="auth-form-heading"><div className="auth-symbol" role="img" aria-label="Мнемодак, бета-версия"><BrandMark/></div><h1 className="auth-title">{title}{beta?<span className="auth-title-beta" title="Бета-версия"><BetaMark size={16}/></span>:null}</h1>{description?<p className="auth-description">{description}</p>:null}</header>;
}
