import React from 'react';
import {MemoryRouter} from 'react-router';
import {App} from './App';
import {ShellErrorBoundary} from './ShellDiagnostics';
import './styles.css';
import './touch.css';
export default function ShellRemote(){return <ShellErrorBoundary><MemoryRouter><App/></MemoryRouter></ShellErrorBoundary>;}
