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
	signals: string;
	preprocessing: string;
	preprocessingDetail: string;
	features: string;
	featuresDetail: string;
	model: string;
	evaluation: string;
	experiments: string;
	experimentsDetail: string;
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
				title: 'Breathing Sensing for HCI',
				institution: 'University of Chicago',
				descriptor:
					'Physiological sensing and machine learning for cognitive-state estimation.',
				description:
					'Contributed to a human-centered computing research project exploring physiological sensing and machine learning for cognitive-state estimation in everyday environments. Developed signal-processing and machine-learning components for physiological feature extraction and cognitive-load estimation, while investigating user variability and practical sensing challenges.',
				fields: [
					{
						label: 'Contribution',
						text: 'Signal-processing and machine-learning components for extracting physiological features and estimating cognitive load from sensor data.',
					},
					{
						label: 'Evaluation',
						text: 'Model comparisons, cross-participant evaluation, and controlled experiments focused on prediction reliability and robustness.',
					},
					{
						label: 'Status',
						text: 'Implemented a real-time sensing and visualization prototype. Manuscript submitted to CHI.',
					},
				],
				keywords: ['Statistical ML', 'Signal Processing', 'Cross-participant Evaluation', 'Human-Centered Computing'],
				diagram: 'breath',
				diagramCopy: {
					ariaLabel: 'Breathing Sensing simplified research workflow',
					title: 'Breathing Sensing workflow',
					description:
						'Physiological signals are processed into features for machine-learning modeling, followed by cross-participant evaluation, controlled experiments, and a real-time sensing prototype.',
					signals: 'Physiological signals',
					preprocessing: 'Signal processing',
					preprocessingDetail: 'conditioning · representation',
					features: 'Physiological features',
					featuresDetail: 'individual variation · environment',
					model: 'Machine-learning model',
					evaluation: 'Cross-participant eval.',
					experiments: 'Controlled experiments',
					experimentsDetail: 'reliability · robustness',
					output: 'Real-time prototype',
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
				title: '面向人机交互的呼吸感知',
				institution: '芝加哥大学',
				descriptor: '利用生理感知与机器学习探索认知状态估计。',
				description:
					'参与面向人机交互的生理感知研究，探索利用机器学习在日常环境中估计认知状态；开发用于生理特征提取与认知负荷估计的信号处理和机器学习组件，并分析用户差异及实际感知挑战。',
				fields: [
					{
						label: '贡献',
						text: '面向传感数据，开发用于生理特征提取与认知负荷估计的信号处理和机器学习组件。',
					},
					{
						label: '评测',
						text: '通过模型比较、跨参与者评测和受控实验，分析预测可靠性与鲁棒性。',
					},
					{
						label: '状态',
						text: '实现实时感知与可视化原型；论文已投稿 CHI。',
					},
				],
				keywords: ['统计机器学习', '信号处理', '跨参与者评测', '人本计算'],
				diagram: 'breath',
				diagramCopy: {
					ariaLabel: '呼吸感知简化研究流程图',
					title: '呼吸感知研究流程',
					description:
						'对生理信号进行处理与特征提取，用于机器学习建模，再通过跨参与者评测与受控实验分析可靠性和鲁棒性，并实现实时感知原型。',
					signals: '生理信号',
					preprocessing: '信号处理',
					preprocessingDetail: '信号调理 · 表征构建',
					features: '生理特征',
					featuresDetail: '个体差异 · 环境因素',
					model: '机器学习模型',
					evaluation: '跨参与者评测',
					experiments: '受控实验',
					experimentsDetail: '可靠性 · 鲁棒性',
					output: '实时感知原型',
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
