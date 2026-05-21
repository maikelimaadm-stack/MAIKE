/**
 * Design System Standards - Padrão Visual Unificado
 * Baseado no Cadastro de Lotes
 * 
 * Use este arquivo para manter a consistência visual
 * em todos os painéis e módulos da aplicação
 */

export const DESIGN_STANDARDS = {
  // Border Radius - Padrão mínimo (1.5px)
  borderRadius: {
    minimal: '1.5px',
    small: '0.25rem',
    default: '0.5rem'
  },

  // Toggle Switch / Checkbox
  checkbox: {
    toggle: '!h-4 !w-8 rounded-full relative inline-flex items-center transition-colors border-0 shadow-none bg-green-500 hover:bg-green-600 cursor-pointer',
    input: 'h-3 w-3 rounded-none border-slate-400 accent-green-500 focus:ring-0'
  },

  // Altura padrão para inputs
  input: {
    height: 'h-[22px]',
    small: 'h-6',
    compact: 'h-8'
  },

  // Buttons - Save/Cancel Pattern
  buttons: {
    save: 'px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-xs font-medium rounded-[1.5px] transition-colors',
    cancel: 'px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-medium rounded-[1.5px] transition-colors',
    delete: 'px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded-[1.5px] transition-colors',
    secondary: 'px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-[1.5px] transition-colors',
    ghost: 'px-4 py-2 bg-transparent hover:bg-slate-100 text-slate-700 text-xs font-medium rounded-[1.5px] transition-colors'
  },

  // Dialog/Modal/Popup
  dialog: {
    header: 'text-sm font-semibold text-slate-900',
    content: 'text-xs text-slate-700',
    footer: 'flex items-center justify-between gap-2 pt-4 border-t border-slate-200'
  },

  // Form Layout
  form: {
    fieldLabel: 'text-[12px] text-slate-600 text-right leading-none',
    fieldContainer: 'grid grid-cols-[190px_minmax(0,1fr)] items-center gap-1',
    fieldBorder: 'border border-slate-300 bg-white rounded-[1.5px] focus-within:border-green-500 transition-colors'
  },

  // Input field wrapper
  fieldWrapper: {
    container: (error) => `h-6 border ${error ? 'border-red-500 bg-red-50' : 'border-slate-300 bg-white'} rounded-[1.5px] focus-within:border-green-500 transition-colors overflow-hidden [&_input]:h-[22px] [&_input]:border-0 [&_input]:rounded-none [&_input]:shadow-none [&_input]:focus-visible:ring-0 [&_button]:h-[22px] [&_button]:border-0 [&_button]:rounded-none [&_button]:shadow-none [&_textarea]:min-h-[48px] [&_textarea]:rounded-none [&_textarea]:border-0 [&_textarea]:shadow-none [&_textarea]:focus-visible:ring-0`,
    input: 'h-[22px] text-xs border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1',
    textarea: 'text-xs uppercase bg-transparent px-1 rounded-none border-0 shadow-none focus-visible:ring-0'
  },

  // Typography
  text: {
    xs: 'text-[11px]',
    sm: 'text-xs',
    base: 'text-sm',
    lg: 'text-base'
  },

  // Colors - Brand
  colors: {
    success: '#16a34a', // green-600
    danger: '#dc2626',  // red-600
    warning: '#ea580c', // orange-600
    info: '#0284c7',    // blue-600
    muted: '#94a3b8'    // slate-400
  }
};

/**
 * Componentes Padrão para Diálogos
 */
export const DIALOG_PATTERNS = {
  // Dialog com header, content e footer
  dialogLayout: {
    wrapper: 'max-w-md w-full rounded-lg shadow-lg border border-slate-200 bg-white',
    header: 'px-6 py-4 border-b border-slate-200',
    content: 'px-6 py-4',
    footer: 'px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2'
  },

  // Buttons pattern: Cancel, Save/Confirm
  actionButtons: (onCancel, onConfirm) => [
    { label: 'Cancelar', onClick: onCancel, className: DESIGN_STANDARDS.buttons.cancel },
    { label: 'Salvar', onClick: onConfirm, className: DESIGN_STANDARDS.buttons.save }
  ]
};

/**
 * Função helper para construir estilos de campo
 */
export const buildFieldClasses = (options = {}) => {
  const { error = false, disabled = false, compact = false } = options;
  const heightClass = compact ? DESIGN_STANDARDS.input.small : DESIGN_STANDARDS.input.height;
  const borderClass = error ? 'border-red-500 bg-red-50' : 'border-slate-300 bg-white';
  
  return `h-6 border ${borderClass} rounded-[1.5px] focus-within:border-green-500 transition-colors ${
    disabled ? 'opacity-50 cursor-not-allowed' : ''
  }`;
};

/**
 * Configuração padrão para inputs
 */
export const INPUT_CONFIG = {
  borderRadius: '1.5px',
  focusRingColor: 'ring-green-500',
  disabledBgColor: 'bg-slate-50',
  errorBgColor: 'bg-red-50',
  errorBorderColor: 'border-red-500'
};

export default DESIGN_STANDARDS;