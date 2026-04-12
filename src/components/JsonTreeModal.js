import React, { useState } from 'react';
import Modal from 'react-modal';

const JsonTreeModal = ({ isOpen, onClose, jsonData }) => {
    const [selectedNode, setSelectedNode] = useState(null);

    const handleNodeClick = (node) => {
        setSelectedNode(node);
    };

    const renderNode = (node) => {
        return (
            <div>
                <div onClick={() => handleNodeClick(node)}>{node.name}</div>
                {node.children && node.children.length > 0 && (
                    <div style={{ marginLeft: '20px' }}>
                        {node.children.map(renderNode)}
                    </div>
                )}
            </div>
        );
    };

    return (
        <Modal isOpen={isOpen} onRequestClose={onClose} contentLabel="JSON Tree">
            <h2>JSON Tree</h2>
            <div>{jsonData && renderNode(jsonData)}</div>
            <button onClick={onClose}>Close</button>
            {selectedNode && (
                <div>
                    <h3>Details:</h3>
                    <pre>{JSON.stringify(selectedNode, null, 2)}</pre>
                </div>
            )}
        </Modal>
    );
};

export default JsonTreeModal;