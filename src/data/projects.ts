import type { SiteLocale } from './profile';

export type ProjectField = {
	label: string;
	text: string;
};

type FlagshipProjectBase = {
	number: string;
	title: string;
	institution: string;
	descriptor: string;
	description: string;
	fields: readonly ProjectField[];
	keywords: readonly string[];
};

export type AudioDiagramCopy = {
	ariaLabel: string;
	title: string;
	description: string;
	semanticFeatures: string;
	acousticFeatures: string;
	fusion: string;
	sharedRepresentation: string;
	split: string;
	semanticBranch: string;
	semanticRate: string;
	projector: string;
	quantizer: string;
	acousticBranch: string;
	acousticRate: string;
	semanticTokens: string;
	acousticTokens: string;
	note: string;
};

export type BreathDiagramCopy = {
	ariaLabel: string;
	title: string;
	description: string;
	microphones: string;
	preprocessing: string;
	preprocessingDetail: string;
	features: string;
	featuresDetail: string;
	model: string;
	normalization: string;
	personalization: string;
	personalizationDetail: string;
	output: string;
};

export type FlagshipProject =
	| (FlagshipProjectBase & {
			diagram: 'audio';
			diagramCopy: AudioDiagramCopy;
	  })
	| (FlagshipProjectBase & {
			diagram: 'breath';
			diagramCopy: BreathDiagramCopy;
	  });

export type CurrentProject = {
	number: string;
	title: string;
	institution: string;
	status: string;
	summary: string;
	detail: string;
	keywords: readonly string[];
};

type ProjectContent = {
	flagshipProjects: readonly FlagshipProject[];
	currentProject: CurrentProject;
};

export const projectContentByLocale = {
	en: {
		flagshipProjects: [
			{
				number: '01',
				title: 'Neural Audio Tokenization',
				institution: 'Tsinghua University',
				descriptor: 'Multi-scale discrete representation learning for neural audio systems.',
				description:
					'Explored discrete neural audio representations through a dual-stream quantization design with separate semantic and acoustic streams at different temporal resolutions. Worked on quantization-module development, alternative quantization designs, controlled baseline comparisons, and ablation-based evaluation.',
				fields: [
					{
						label: 'Architecture',
						text: 'Dual-stream semantic and acoustic modeling at 25 Hz and 50 Hz with finite scalar quantization.',
					},
					{
						label: 'Contribution',
						text: 'Quantization-module development and evaluation of alternative quantization designs.',
					},
					{
						label: 'Evaluation',
						text: 'Controlled baseline comparisons and component-level ablation studies.',
					},
				],
				keywords: ['Representation Learning', 'Neural Audio', 'Quantization', 'Multi-scale Modeling'],
				diagram: 'audio',
				diagramCopy: {
					ariaLabel: 'Neural Audio Tokenization simplified technical pipeline',
					title: 'Neural Audio Tokenization pipeline',
					description:
						'SSL semantic features and acoustic features are fused into a shared representation, then split into semantic and acoustic branches. The semantic branch pools from 50 to 25 hertz before projection and finite scalar quantization, while the acoustic branch remains at 50 hertz.',
					semanticFeatures: 'SSL / Semantic Features',
					acousticFeatures: 'Acoustic Features',
					fusion: 'Fusion',
					sharedRepresentation: 'Shared Representation',
					split: 'Split',
					semanticBranch: 'Semantic branch',
					semanticRate: 'Pool 50 → 25 Hz',
					projector: 'Projector',
					quantizer: 'FSQ',
					acousticBranch: 'Acoustic branch',
					acousticRate: '50 Hz direct',
					semanticTokens: 'Semantic Tokens',
					acousticTokens: 'Acoustic Tokens',
					note: 'FSQ: finite scalar quantization.',
				},
			},
			{
				number: '02',
				title: 'Cognitive-Breath',
				institution: 'University of Chicago',
				descriptor:
					'Estimating cognitive load from respiratory signals captured through eyeglass nose-pad contact microphones.',
				description:
					'Developed an end-to-end pipeline for cognitive-load estimation from respiratory signals captured by contact microphones beneath eyeglass nose pads, spanning synchronized acquisition, signal preprocessing, respiratory feature extraction, cross-user modeling, optional personalization, and streaming inference.',
				fields: [
					{
						label: 'Evaluation',
						text: 'Cross-user evaluation, feature ablations, bilateral-channel fusion, acoustic and motion robustness, and sampling-rate / synchronization analysis.',
					},
					{
						label: 'Result',
						text: 'Online normalization and optional personalization improved block-level performance over the base cross-user model.',
					},
					{
						label: 'Status',
						text: 'Manuscript currently under review.',
					},
				],
				keywords: ['Statistical ML', 'Signal Processing', 'Cross-user Evaluation', 'Real-time Systems'],
				diagram: 'breath',
				diagramCopy: {
					ariaLabel: 'Cognitive-Breath simplified technical pipeline',
					title: 'Cognitive-Breath pipeline',
					description:
						'Synchronized contact-microphone signals are preprocessed into respiratory features for a cross-user model, followed by online normalization, optional personalization, and a real-time probability estimate.',
					microphones: 'Nose-pad microphones',
					preprocessing: 'Signal preprocessing',
					preprocessingDetail: '24 kHz sync · band-pass · envelopes',
					features: 'Respiratory features',
					featuresDetail: 'Cycle · rhythm · amplitude · bilateral',
					model: 'Cross-user model',
					normalization: 'Online normalization',
					personalization: 'Optional personalization',
					personalizationDetail: 'user-specific calibration',
					output: 'Real-time probability',
				},
			},
		],
		currentProject: {
			number: '03',
			title: 'Open-Environment Multimodal Sensing',
			institution: 'Tsinghua University Future Lab',
			status: 'Current work',
			summary: 'Multimodal perception in open environments.',
			detail:
				'Exploring gas sensing, acoustic information, and thermal sensing, with current emphasis on environmental interference, sensor response, cross-scene generalization, and multimodal modeling.',
			keywords: ['Multimodal Sensing', 'Electronic Olfaction', 'Acoustics', 'Thermal Sensing'],
		},
	},
	zh: {
		flagshipProjects: [
			{
				number: '01',
				title: '神经音频离散编码',
				institution: '清华大学',
				descriptor: '面向神经音频系统的多尺度离散表征学习。',
				description:
					'围绕离散神经音频表征开展研究，采用双流量化设计，在不同时间分辨率下分别建模语义与声学信息。工作涵盖量化模块开发、替代量化方案、受控基线比较和消融评测。',
				fields: [
					{
						label: '架构',
						text: '以 25 Hz 和 50 Hz 分别进行语义与声学双流建模，并采用有限标量量化（FSQ）。',
					},
					{
						label: '贡献',
						text: '开发量化模块，并实现和评估替代量化设计。',
					},
					{
						label: '评测',
						text: '开展受控基线比较与模块级消融实验。',
					},
				],
				keywords: ['表征学习', '神经音频', '量化', '多尺度建模'],
				diagram: 'audio',
				diagramCopy: {
					ariaLabel: '神经音频离散编码简化技术流程图',
					title: '神经音频离散编码流程',
					description:
						'SSL 语义特征与声学特征先融合为共享表征，再分为语义与声学两个分支。语义分支先由 50 Hz 池化至 25 Hz，随后经过投影与有限标量量化；声学分支保持 50 Hz。',
					semanticFeatures: 'SSL / 语义特征',
					acousticFeatures: '声学特征',
					fusion: '融合',
					sharedRepresentation: '共享表征',
					split: '分流',
					semanticBranch: '语义分支',
					semanticRate: '池化 50 → 25 Hz',
					projector: '投影层',
					quantizer: 'FSQ',
					acousticBranch: '声学分支',
					acousticRate: '50 Hz 直通',
					semanticTokens: '语义 Token',
					acousticTokens: '声学 Token',
					note: 'FSQ：有限标量量化。',
				},
			},
			{
				number: '02',
				title: 'Cognitive-Breath',
				institution: '芝加哥大学',
				descriptor: '利用眼镜鼻托接触式麦克风采集的呼吸信号估计认知负荷。',
				description:
					'构建了一套端到端认知负荷估计流程，输入为眼镜鼻托下方接触式麦克风采集的呼吸信号，涵盖同步采集、信号预处理、呼吸特征提取、跨用户建模、可选个体化与流式推断。',
				fields: [
					{
						label: '评测',
						text: '开展跨用户评测、特征消融、双通道融合、声学与运动鲁棒性分析，以及采样率与同步误差分析。',
					},
					{
						label: '结果',
						text: '在线归一化与可选个体化相较基础跨用户模型提升了区块级表现。',
					},
					{
						label: '状态',
						text: '论文目前正在审稿中。',
					},
				],
				keywords: ['统计机器学习', '信号处理', '跨用户评测', '实时系统'],
				diagram: 'breath',
				diagramCopy: {
					ariaLabel: 'Cognitive-Breath 简化技术流程图',
					title: 'Cognitive-Breath 技术流程',
					description:
						'对同步采集的接触式麦克风信号进行预处理并提取呼吸特征，输入跨用户模型，再经在线归一化与可选个体化，输出实时概率估计。',
					microphones: '鼻托接触式麦克风',
					preprocessing: '信号预处理',
					preprocessingDetail: '24 kHz 同步 · 带通滤波 · 包络提取',
					features: '呼吸特征',
					featuresDetail: '周期 · 节律 · 幅度 · 双通道',
					model: '跨用户模型',
					normalization: '在线归一化',
					personalization: '可选个体化',
					personalizationDetail: '用户级校准',
					output: '实时概率估计',
				},
			},
		],
		currentProject: {
			number: '03',
			title: '开放环境多模态感知',
			institution: '清华大学未来实验室',
			status: '在研',
			summary: '开放环境中的多模态感知。',
			detail: '探索气体传感、声学信息与热传感，当前重点关注环境干扰、传感器响应、跨场景泛化与多模态建模。',
			keywords: ['多模态感知', '电子嗅觉', '声学', '热传感'],
		},
	},
} as const satisfies Record<SiteLocale, ProjectContent>;
